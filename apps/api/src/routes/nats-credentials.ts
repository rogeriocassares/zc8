/**
 * Application NATS Credentials Routes
 *
 * Generates and manages per-application NATS user credentials (NKey pair +
 * signed JWT). The JWT encodes pub/sub permissions scoped by the application's
 * visibility, granting direct JetStream access for per-device telemetry replay.
 *
 * Subject scoping (TELEMETRY stream):
 *   team   → telemetry.raw.{org_id}.{team_id}.>
 *   org    → telemetry.raw.{org_id}.>
 *   public → telemetry.raw.>
 *
 * The JWT also grants JetStream consumer CRUD API permissions so the browser
 * can create ephemeral ordered consumers directly via nats.js.
 *
 * A NATS account key pair (operator-signed) must be configured via the
 * NATS_ACCOUNT_SEED environment variable for JWT signing to work.
 *
 * Routes:
 *   GET    /api/v1/applications/:app_id/nats-credentials  – retrieve credentials
 *   POST   /api/v1/applications/:app_id/nats-credentials  – generate / regenerate
 *   DELETE /api/v1/applications/:app_id/nats-credentials  – revoke credentials
 */

import * as crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import * as nkeys from "nkeys.js";
import type { DrizzleDB } from "../db";
import {
  type AuthContext,
  getOrgMemberRole,
  getTeamMemberRole,
  requireAuth,
} from "../db/auth";
import {
  applicationNatsCredentials,
  applications,
  organizations,
  teams,
} from "../db/schema";

// ─── NATS JWT helpers ─────────────────────────────────────────────────────────

/** base64url-encode from bytes or a JSON string */
function b64url(data: Uint8Array | string): string {
  const buf =
    typeof data === "string"
      ? Buffer.from(data, "utf8")
      : Buffer.from(data);
  return buf.toString("base64url");
}

/**
 * Build a signed NATS user JWT.
 *
 * @param userPublicKey  The 'U...' NKey public key of the user.
 * @param accountKp      The account KeyPair used to sign the JWT.
 * @param name           Human-readable name for the credential.
 * @param subAllow       Subscribe permission subjects.
 * @param pubAllow       Publish permission subjects.
 * @param expiresInSecs  Seconds until the JWT expires.  0 = no expiry.
 */
function buildNatsUserJwt(
  userPublicKey: string,
  accountKp: nkeys.KeyPair,
  name: string,
  subAllow: string[],
  pubAllow: string[],
  expiresInSecs = 0,
): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ed25519-nkey" }));
  const now = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = {
    jti: crypto.randomUUID().replace(/-/g, ""),
    iat: now,
    iss: accountKp.getPublicKey(),
    sub: userPublicKey,
    name,
    nats: {
      type: "user",
      version: 2,
      pub: { allow: pubAllow },
      sub: { allow: subAllow },
      subs: -1,
      data: -1,
      payload: -1,
    },
  };

  if (expiresInSecs > 0) {
    claims.exp = now + expiresInSecs;
  }

  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const sig = accountKp.sign(new TextEncoder().encode(signingInput));
  return `${header}.${payload}.${b64url(sig)}`;
}

/** Format a standard NATS .creds file. */
function buildCredsFile(jwt: string, seedStr: string): string {
  return [
    "-----BEGIN NATS USER JWT-----",
    jwt,
    "------END NATS USER JWT------",
    "",
    "-----BEGIN USER NKEY SEED-----",
    seedStr,
    "------END USER NKEY SEED------",
    "",
  ].join("\n");
}

/**
 * Derive subject permission patterns from application visibility.
 *
 * Subjects use the JetStream TELEMETRY stream (telemetry.raw.*) instead of
 * the old NATS Core realtime subjects.  The browser connects directly with
 * nats.js, creates an ephemeral ordered consumer via the JetStream API, and
 * receives per-device replay through its inbox delivery subject.
 *
 * Permissions granted:
 *   sub  – scoped data subjects + _INBOX.> (JetStream push-consumer delivery)
 *   pub  – JetStream consumer CRUD API + _INBOX.> (request/reply inboxes)
 *
 * @param visibility  'team' | 'org' | 'public'
 * @param orgId       Organization ID
 * @param teamId      Team ID (required when visibility = 'team')
 */
function deriveSubjects(
  visibility: string,
  orgId: number,
  teamId: number,
): { sub: string[]; pub: string[] } {
  // Data subject that the consumer filter will be restricted to.
  let dataSubject: string;
  switch (visibility) {
    case "public":
      dataSubject = "telemetry.raw.>";
      break;
    case "org":
      dataSubject = `telemetry.raw.${orgId}.>`;
      break;
    case "team":
    default:
      dataSubject = `telemetry.raw.${orgId}.${teamId}.>`;
      break;
  }

  // JetStream API subjects for ordered/ephemeral consumer lifecycle.
  const jsApiSub = [
    "$JS.API.CONSUMER.CREATE.TELEMETRY",
    "$JS.API.CONSUMER.INFO.TELEMETRY.>",
    "$JS.API.CONSUMER.DELETE.TELEMETRY.>",
    "$JS.API.STREAM.INFO.TELEMETRY",
  ];

  return {
    // Subscribe: scoped data subject (for direct core sub) + inbox for JS delivery.
    sub: [dataSubject, "_INBOX.>"],
    // Publish: JetStream consumer API + inbox (request/reply pattern).
    pub: [...jsApiSub, "_INBOX.>"],
  };
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createNatsCredentialRoutes(db: DrizzleDB) {
  const ACCOUNT_SEED = process.env.NATS_ACCOUNT_SEED ?? "";

  return new Elysia({ prefix: "/api/v1/applications/:app_id/nats-credentials" })
    .use(requireAuth())

    // ── GET – retrieve existing credentials ──────────────────────────────────
    .get("/", async (ctx) => {
      const { app_id } = ctx.params;
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const set = (ctx as unknown as { set: { status: number } }).set;

      const appId = Number(app_id);

      // Load app + team + org
      const rows = await db
        .select({
          appId: applications.id,
          teamId: applications.teamId,
          orgId: organizations.id,
          createdBy: applications.createdBy,
        })
        .from(applications)
        .innerJoin(teams, eq(applications.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .where(eq(applications.id, appId));

      if (rows.length === 0) {
        set.status = 404;
        return { success: false, error: "Application not found" };
      }

      const { teamId, orgId } = rows[0];

      // Auth: superAdmin or org/team member
      if (auth.role !== "superAdmin") {
        const teamRole = await getTeamMemberRole(db, auth.userId, teamId);
        const orgRole = await getOrgMemberRole(db, auth.userId, orgId);
        if (!teamRole && !orgRole) {
          set.status = 403;
          return { success: false, error: "Insufficient permissions" };
        }
      }

      const [cred] = await db
        .select()
        .from(applicationNatsCredentials)
        .where(eq(applicationNatsCredentials.applicationId, appId));

      if (!cred) {
        set.status = 404;
        return { success: false, error: "No NATS credentials found for this application" };
      }

      return {
        success: true,
        data: {
          id: cred.id,
          application_id: cred.applicationId,
          nkey_public: cred.nkeyPublic,
          nats_jwt: cred.natsJwt,
          creds: cred.creds,
          sub_permissions: cred.subPermissions,
          pub_permissions: cred.pubPermissions,
          expires_at: cred.expiresAt,
          created_at: cred.createdAt,
          updated_at: cred.updatedAt,
        },
      };
    })

    // ── POST – generate (or regenerate) credentials ───────────────────────────
    .post("/", async (ctx) => {
      const { app_id } = ctx.params;
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const set = (ctx as unknown as { set: { status: number } }).set;

      if (!ACCOUNT_SEED) {
        set.status = 503;
        return {
          success: false,
          error: "NATS JWT signing is not configured (NATS_ACCOUNT_SEED missing)",
        };
      }

      const appId = Number(app_id);

      // Load app with team + org + visibility
      const rows = await db
        .select({
          appId: applications.id,
          appName: applications.name,
          teamId: applications.teamId,
          orgId: organizations.id,
          visibility: applications.visibility,
          createdBy: applications.createdBy,
        })
        .from(applications)
        .innerJoin(teams, eq(applications.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .where(eq(applications.id, appId));

      if (rows.length === 0) {
        set.status = 404;
        return { success: false, error: "Application not found" };
      }

      const { appName, teamId, orgId, visibility } = rows[0];

      // Auth: superAdmin or org admin / team admin
      if (auth.role !== "superAdmin") {
        const teamRole = await getTeamMemberRole(db, auth.userId, teamId);
        const orgRole = await getOrgMemberRole(db, auth.userId, orgId);
        if (!teamRole && !orgRole) {
          set.status = 403;
          return { success: false, error: "Insufficient permissions" };
        }
      }

      // Load account keypair from seed
      let accountKp: nkeys.KeyPair;
      try {
        const seedBytes = new TextEncoder().encode(ACCOUNT_SEED);
        accountKp = nkeys.fromSeed(seedBytes);
      } catch {
        set.status = 500;
        return { success: false, error: "Invalid NATS_ACCOUNT_SEED" };
      }

      // Generate user keypair
      const userKp = nkeys.createUser();
      const userPublicKey = userKp.getPublicKey();
      const seedStr = new TextDecoder().decode(userKp.getSeed());

      // Derive subject permissions from visibility
      const { sub: subAllow, pub: pubAllow } = deriveSubjects(
        visibility,
        orgId,
        teamId,
      );

      // Build signed JWT (1-year expiry by default)
      const JWT_EXPIRY_SECS = 365 * 24 * 3600;
      const jwt = buildNatsUserJwt(
        userPublicKey,
        accountKp,
        `${appName}-app-${appId}`,
        subAllow,
        pubAllow,
        JWT_EXPIRY_SECS,
      );

      const creds = buildCredsFile(jwt, seedStr);
      const expiresAt = new Date(Date.now() + JWT_EXPIRY_SECS * 1000);

      // Upsert (delete existing then insert to avoid duplicate constraint issues)
      await db
        .delete(applicationNatsCredentials)
        .where(eq(applicationNatsCredentials.applicationId, appId));

      const [created] = await db
        .insert(applicationNatsCredentials)
        .values({
          applicationId: appId,
          nkeyPublic: userPublicKey,
          nkeySeed: seedStr,
          natsJwt: jwt,
          creds,
          subPermissions: subAllow,
          pubPermissions: pubAllow,
          expiresAt,
        })
        .returning();

      set.status = 201;
      return {
        success: true,
        data: {
          id: created.id,
          application_id: created.applicationId,
          nkey_public: created.nkeyPublic,
          nats_jwt: created.natsJwt,
          creds: created.creds,
          sub_permissions: created.subPermissions,
          pub_permissions: created.pubPermissions,
          expires_at: created.expiresAt,
          created_at: created.createdAt,
          updated_at: created.updatedAt,
        },
      };
    })

    // ── DELETE – revoke credentials ───────────────────────────────────────────
    .delete("/", async (ctx) => {
      const { app_id } = ctx.params;
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const set = (ctx as unknown as { set: { status: number } }).set;

      const appId = Number(app_id);

      const rows = await db
        .select({
          teamId: applications.teamId,
          orgId: organizations.id,
        })
        .from(applications)
        .innerJoin(teams, eq(applications.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .where(eq(applications.id, appId));

      if (rows.length === 0) {
        set.status = 404;
        return { success: false, error: "Application not found" };
      }

      const { teamId, orgId } = rows[0];

      if (auth.role !== "superAdmin") {
        const teamRole = await getTeamMemberRole(db, auth.userId, teamId);
        const orgRole = await getOrgMemberRole(db, auth.userId, orgId);
        if (!teamRole && !orgRole) {
          set.status = 403;
          return { success: false, error: "Insufficient permissions" };
        }
      }

      await db
        .delete(applicationNatsCredentials)
        .where(eq(applicationNatsCredentials.applicationId, appId));

      return { success: true, message: "NATS credentials revoked" };
    });
}
