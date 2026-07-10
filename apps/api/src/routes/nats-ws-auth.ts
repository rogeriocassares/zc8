/**
 * NATS WebSocket Auth Callout
 *
 * Subscribes to $SYS.REQ.USER.AUTH on the NATS server and handles
 * authentication for browser clients connecting directly to NATS via
 * WebSocket (port 4223).
 *
 * Flow:
 *   1. Browser connects to ws://host:4223 with its API JWT as bearer token.
 *   2. NATS server routes the connection request here via $SYS.REQ.USER.AUTH.
 *   3. We decode the request JWT, extract the bearer token, validate it as
 *      an API JWT (same HS256 scheme used by the rest of the API).
 *   4. On success: issue a scoped NATS User JWT that grants subscribe-only
 *      access to telemetry.realtime.{orgId}.> (or full telemetry.realtime.>
 *      for superAdmins). Sign it with the account NKey seed.
 *   5. The signed User JWT is the reply — NATS grants the connection.
 *   6. On failure: reply with {"error":"Unauthorized"} — NATS rejects the
 *      connection immediately.
 *
 * Subject permissions issued:
 *   sub: telemetry.realtime.{orgId}.>   (or telemetry.realtime.> for admins)
 *   pub: (none — browser only subscribes)
 *
 * Environment required:
 *   NATS_ACCOUNT_SEED – Account NKey seed (S-prefix, A-type) used to sign
 *                       User JWTs in callout responses.
 */

import * as crypto from "node:crypto";
import type { NatsConnection } from "nats";
import * as nkeys from "nkeys.js";
import { validateToken } from "../db/auth";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function b64url(data: Uint8Array | string): string {
  const buf =
    typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return buf.toString("base64url");
}

function decodeB64url(s: string): string {
  // Pad to multiple of 4 for Buffer.from
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  return Buffer.from(s + "=".repeat(pad), "base64").toString("utf8");
}

/**
 * Build a scoped NATS User JWT signed by the account NKey.
 * The JWT grants subscribe access to the given subjects only.
 */
function buildUserJwt(
  userPubKey: string,
  accountKp: nkeys.KeyPair,
  name: string,
  subjectAllow: string[],
  expiresInSecs = 3600, // 1-hour live sessions
): string {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ed25519-nkey" }));
  const now = Math.floor(Date.now() / 1000);

  const payload = b64url(
    JSON.stringify({
      jti: crypto.randomUUID().replace(/-/g, ""),
      iat: now,
      exp: now + expiresInSecs,
      iss: accountKp.getPublicKey(),
      sub: userPubKey,
      name,
      nats: {
        type: "user",
        version: 2,
        pub: { deny: [">"] }, // browsers cannot publish
        sub: { allow: subjectAllow }, // scoped subscribe permissions
        subs: -1,
        data: -1,
        payload: -1,
        bearer_token: true,
      },
    }),
  );

  const signingInput = `${header}.${payload}`;
  const sig = accountKp.sign(new TextEncoder().encode(signingInput));
  return `${header}.${payload}.${b64url(sig)}`;
}

// ─── Callout service ──────────────────────────────────────────────────────────

/**
 * Start the NATS auth callout service.
 * Call this once after the NATS connection is established.
 * The returned stop function drains the subscription on shutdown.
 */
export async function startNatsAuthCallout(
  nc: NatsConnection,
): Promise<() => void> {
  const accountSeed = process.env.NATS_ACCOUNT_SEED ?? "";

  if (!accountSeed || accountSeed.startsWith("SAAA...")) {
    console.warn(
      "[nats-auth-callout] NATS_ACCOUNT_SEED not configured — " +
      "browser direct NATS connections will be rejected. " +
      "Run scripts/generate-nats-account-key.ts to generate keys.",
    );
    // Still subscribe but always reject — avoids NATS server timeout
    const sub = nc.subscribe("$SYS.REQ.USER.AUTH");
    (async () => {
      for await (const msg of sub) {
        msg.respond(
          new TextEncoder().encode(
            JSON.stringify({
              error: "NATS_ACCOUNT_SEED not configured on server",
            }),
          ),
        );
      }
    })();
    return () => sub.unsubscribe();
  }

  // Load account NKey from seed
  let accountKp: nkeys.KeyPair;
  try {
    accountKp = nkeys.fromSeed(new TextEncoder().encode(accountSeed));
  } catch (e) {
    console.error("[nats-auth-callout] Invalid NATS_ACCOUNT_SEED:", e);
    const sub = nc.subscribe("$SYS.REQ.USER.AUTH");
    (async () => {
      for await (const msg of sub) {
        msg.respond(
          new TextEncoder().encode(
            JSON.stringify({ error: "Server key misconfiguration" }),
          ),
        );
      }
    })();
    return () => sub.unsubscribe();
  }

  const sub = nc.subscribe("$SYS.REQ.USER.AUTH");
  console.log("[nats-auth-callout] Subscribed to $SYS.REQ.USER.AUTH");

  (async () => {
    for await (const msg of sub) {
      try {
        // The auth request is a JWT: header.payload.signature
        // We decode the payload to read user_info.token (the API JWT).
        const raw = new TextDecoder().decode(msg.data);
        const parts = raw.split(".");
        if (parts.length < 2) {
          msg.respond(
            new TextEncoder().encode(
              JSON.stringify({ error: "Invalid auth request format" }),
            ),
          );
          continue;
        }

        let requestPayload: Record<string, unknown>;
        try {
          requestPayload = JSON.parse(decodeB64url(parts[1] as string));
        } catch {
          msg.respond(
            new TextEncoder().encode(
              JSON.stringify({ error: "Malformed auth request" }),
            ),
          );
          continue;
        }

        // Extract bearer token from the connection:
        // nats.user_info.token is the bearer token passed by nats.ws client
        const natsSection = requestPayload.nats as
          | Record<string, unknown>
          | undefined;
        const userInfo = natsSection?.user_info as
          | Record<string, unknown>
          | undefined;
        const connectOpts = natsSection?.connect_opts as
          | Record<string, unknown>
          | undefined;
        const bearerToken =
          (userInfo?.token as string | undefined) ??
          (connectOpts?.auth_token as string | undefined);

        if (!bearerToken) {
          msg.respond(
            new TextEncoder().encode(
              JSON.stringify({ error: "No bearer token provided" }),
            ),
          );
          continue;
        }

        // Validate the API JWT
        const authPayload = validateToken(bearerToken);
        if (!authPayload) {
          msg.respond(
            new TextEncoder().encode(JSON.stringify({ error: "Unauthorized" })),
          );
          continue;
        }

        // Determine subject scope from the user's role and org
        const subjectAllow =
          authPayload.role === "superAdmin"
            ? ["telemetry.realtime.>"]
            : authPayload.orgId != null
              ? [`telemetry.realtime.${authPayload.orgId}.>`]
              : [];

        if (subjectAllow.length === 0) {
          msg.respond(
            new TextEncoder().encode(
              JSON.stringify({ error: "No organization scope" }),
            ),
          );
          continue;
        }

        // Generate a per-user User NKey (ephemeral)
        const userKp = nkeys.createUser();
        const userPubKey = userKp.getPublicKey();

        const userName = authPayload.email ?? `user-${authPayload.userId}`;
        const userJwt = buildUserJwt(
          userPubKey,
          accountKp,
          userName,
          subjectAllow,
          3600, // 1-hour validity
        );

        msg.respond(new TextEncoder().encode(userJwt));

        console.log(
          `[nats-auth-callout] Issued credentials for ${userName} ` +
          `scope=${subjectAllow[0]}`,
        );
      } catch (e) {
        console.error("[nats-auth-callout] Unhandled error:", e);
        try {
          msg.respond(
            new TextEncoder().encode(
              JSON.stringify({ error: "Internal server error" }),
            ),
          );
        } catch {
          /* ignore */
        }
      }
    }
  })();

  return () => {
    sub.unsubscribe();
  };
}
