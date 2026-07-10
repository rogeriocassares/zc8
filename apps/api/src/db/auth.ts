/**
 * Auth Middleware for ElysiaJS + Drizzle + Better Auth
 *
 * Provides:
 *   • JWT token generation & validation (HS256)
 *   • RBAC enforcement: superAdmin, owner, admin, member
 *   • Tenant-scoped request context derivation
 *   • Elysia plugin that injects `auth` into handler context
 *
 * All org-scoped queries MUST use the orgId from the validated auth context.
 */

import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";

import type { DrizzleDB } from "../db";
import {
  type MemberRole,
  memberships,
  organizations,
  roles,
  teamMembers,
  type UserRole,
  users,
} from "../db/schema";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole; // platform-level role
  userPlan?: string; // the authenticated user's own plan
  orgId: number | null;
  orgName: string | null;
  memberRole: MemberRole | null; // org-level role
  scopes: string[];
  iat: number;
  exp: number;
}

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  userPlan?: string;
  orgId: number | null;
  orgName: string | null;
  memberRole: MemberRole | null;
  scopes: string[];
}

// ─── Scope maps ────────────────────────────────────────────────────────────────

const MEMBER_SCOPES: Record<MemberRole, string[]> = {
  owner: [
    "org:read",
    "org:write",
    "org:delete",
    "org:admin",
    "members:read",
    "members:write",
    "members:manage",
    "teams:read",
    "teams:write",
    "teams:delete",
    "devices:read",
    "devices:write",
    "devices:delete",
    "apps:read",
    "apps:write",
    "apps:delete",
    "transport:read",
    "transport:write",
    "transport:delete",
    "commands:read",
    "commands:write",
  ],
  admin: [
    "org:read",
    "org:write",
    "org:admin",
    "members:read",
    "members:write",
    "members:manage",
    "teams:read",
    "teams:write",
    "teams:delete",
    "devices:read",
    "devices:write",
    "devices:delete",
    "apps:read",
    "apps:write",
    "apps:delete",
    "transport:read",
    "transport:write",
    "transport:delete",
    "commands:read",
    "commands:write",
  ],
  member: [
    "org:read",
    "members:read",
    "teams:read",
    "apps:read",
    "devices:read",
    "transport:read",
    "commands:read",
    "commands:write",
  ],
};

function scopesForRole(role: MemberRole): string[] {
  return MEMBER_SCOPES[role] ?? MEMBER_SCOPES.member;
}

// ─── JWT helpers (HS256 — same as existing auth-middleware.ts) ──────────────────

const JWT_SECRET =
  process.env.JWT_SECRET || "zc8-dev-secret-key-change-in-prod";
const JWT_EXPIRY_SEC = 86_400; // 24 h

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac256(data: string): Buffer {
  return crypto.createHmac("sha256", JWT_SECRET).update(data).digest();
}

export function generateToken(payload: Omit<AuthPayload, "iat" | "exp">): {
  token: string;
  expiresAt: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const full: AuthPayload = { ...payload, iat: now, exp: now + JWT_EXPIRY_SEC };
  const header = base64url(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const body = base64url(Buffer.from(JSON.stringify(full)));
  const signature = base64url(hmac256(`${header}.${body}`));
  return {
    token: `${header}.${body}.${signature}`,
    expiresAt: (now + JWT_EXPIRY_SEC) * 1000,
  };
}

export function validateToken(token: string): AuthPayload | null {
  try {
    const [header, body, sig] = token.split(".");
    if (!header || !body || !sig) return null;
    const expected = base64url(hmac256(`${header}.${body}`));
    if (sig !== expected) return null;
    const payload: AuthPayload = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    );
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

// ─── In-process active-status cache (replaces Redis) ─────────────────────────

interface ActiveCacheEntry {
  active: boolean;
  expiresAt: number; // ms epoch
}
const _activeCache = new Map<string, ActiveCacheEntry>();
const ACTIVE_CACHE_TTL_MS = 30_000; // 30 seconds — same as former Redis TTL

function getCachedActive(userId: string): boolean | null {
  const entry = _activeCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _activeCache.delete(userId);
    return null;
  }
  return entry.active;
}

function setCachedActive(userId: string, active: boolean): void {
  _activeCache.set(userId, { active, expiresAt: Date.now() + ACTIVE_CACHE_TTL_MS });
}

/**
 * Check if userId is active. Uses an in-process TTL cache (30 s) to avoid a
 * DB hit on every authenticated request.
 * Returns true if active or if the DB cannot be reached (fail-open).
 */
async function isUserActive(db: DrizzleDB, userId: string): Promise<boolean> {
  const cached = getCachedActive(userId);
  if (cached !== null) return cached;
  try {
    const [row] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const active = row?.isActive !== false;
    setCachedActive(userId, active);
    return active;
  } catch {
    // fail-open: token stays valid if we can't check
    return true;
  }
}

// ─── Elysia auth plugin ────────────────────────────────────────────────────────

/**
 * Elysia plugin that:
 *   1. Validates the JWT from `Authorization: Bearer <token>`
 *   2. Derives `auth: AuthContext` on the request context
 *   3. Rejects unauthenticated requests with 401
 */
export function authPlugin(db: DrizzleDB) {
  return new Elysia({ name: "auth" }).derive(
    { as: "global" },
    async ({ request }) => {
      const token = extractBearer(request.headers.get("Authorization"));
      if (!token) {
        return { auth: null as AuthContext | null };
      }

      const payload = validateToken(token);
      if (!payload) {
        return { auth: null as AuthContext | null };
      }

      // Per-request active-status check (Redis-cached, 30 s TTL)
      const active = await isUserActive(db, payload.userId);
      if (!active) {
        return { auth: null as AuthContext | null };
      }

      const auth: AuthContext = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        userPlan: payload.userPlan,
        orgId: payload.orgId ?? null,
        orgName: payload.orgName ?? null,
        memberRole: payload.memberRole ?? null,
        scopes: payload.scopes,
      };

      return { auth: auth as AuthContext | null };
    },
  );
}

/**
 * Guard: require a valid auth context (401 if missing).
 * Use in route chains: `.use(requireAuth)`.
 */
export function requireAuth() {
  return new Elysia({ name: "requireAuth" }).onBeforeHandle(
    { as: "scoped" },
    (ctx) => {
      const { auth, set } = ctx as unknown as {
        auth: AuthContext | null;
        set: { status: number };
      };
      if (!auth) {
        set.status = 401;
        return { success: false, error: "Authentication required" };
      }
    },
  );
}

/**
 * Guard: require the user to be a superAdmin (403 if not).
 */
export function requireSuperAdmin() {
  return new Elysia({ name: "requireSuperAdmin" }).onBeforeHandle(
    { as: "scoped" },
    (ctx) => {
      const { auth, set } = ctx as unknown as {
        auth: AuthContext | null;
        set: { status: number };
      };
      if (!auth || auth.role !== "superAdmin") {
        set.status = 403;
        return { success: false, error: "Super admin access required" };
      }
    },
  );
}

/**
 * Guard: require a minimum org-level role.
 * Role hierarchy: owner > admin > member
 */
export function requireOrgRole(...allowed: MemberRole[]) {
  return new Elysia({ name: "requireOrgRole" }).onBeforeHandle(
    { as: "scoped" },
    (ctx) => {
      const { auth, set } = ctx as unknown as {
        auth: AuthContext | null;
        set: { status: number };
      };
      if (!auth) {
        set.status = 401;
        return { success: false, error: "Authentication required" };
      }
      // superAdmin always passes org-level checks
      if (auth.role === "superAdmin") return;
      if (auth.memberRole === null || !allowed.includes(auth.memberRole)) {
        set.status = 403;
        return {
          success: false,
          error: `Requires one of: ${allowed.join(", ")}`,
        };
      }
    },
  );
}

/**
 * Guard: require a specific scope string (e.g. "devices:write").
 */
export function requireScope(scope: string) {
  return new Elysia({ name: `requireScope:${scope}` }).onBeforeHandle(
    { as: "scoped" },
    (ctx) => {
      const { auth, set } = ctx as unknown as {
        auth: AuthContext | null;
        set: { status: number };
      };
      if (!auth) {
        set.status = 401;
        return { success: false, error: "Authentication required" };
      }
      if (auth.role === "superAdmin") return;
      if (!auth.scopes.includes(scope)) {
        set.status = 403;
        return { success: false, error: `Missing scope: ${scope}` };
      }
    },
  );
}

// ─── Login helper ──────────────────────────────────────────────────────────────

/**
 * Authenticate a user by email + password, returning a JWT with org context.
 * Looks up the user's primary (first-joined) organization.
 */
export async function authenticateUser(
  db: DrizzleDB,
  email: string,
  password: string,
): Promise<
  | { success: true; token: string; expiresAt: number; session: AuthContext }
  | { success: false; error: string }
> {
  // Find user
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user) return { success: false, error: "Invalid email or password" };

  // Block deactivated accounts immediately
  if (user.isActive === false)
    return {
      success: false,
      error: "Account is disabled. Contact your administrator.",
    };

  // Verify password (SHA-256 as currently used)
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (hash !== user.passwordHash)
    return { success: false, error: "Invalid email or password" };

  // Get primary org membership
  const membership = await db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      roleName: roles.name,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(
      and(eq(memberships.userId, user.id), eq(organizations.status, "active")),
    )
    .orderBy(memberships.joinedAt)
    .limit(1);

  const org = membership.length > 0 ? membership[0] : null;
  const memberRole = org ? (org.roleName.toLowerCase() as MemberRole) : null;
  const scopes = memberRole
    ? scopesForRole(memberRole)
    : user.role === "superAdmin"
      ? [
        "org:read",
        "org:write",
        "org:delete",
        "org:admin",
        "members:read",
        "members:write",
        "members:manage",
        "teams:read",
        "teams:write",
        "teams:delete",
        "apps:read",
        "apps:write",
        "apps:delete",
        "devices:read",
        "devices:write",
        "devices:delete",
        "transport:read",
        "transport:write",
        "transport:delete",
        "commands:read",
        "commands:write",
      ]
      : [];

  const { token, expiresAt } = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role as UserRole,
    userPlan: user.plan ?? undefined,
    orgId: org?.orgId ?? null,
    orgName: org?.orgName ?? null,
    memberRole,
    scopes,
  });

  return {
    success: true,
    token,
    expiresAt,
    session: {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      userPlan: user.plan ?? undefined,
      orgId: org?.orgId ?? null,
      orgName: org?.orgName ?? null,
      memberRole,
      scopes,
    },
  };
}

// ─── Per-request role lookups ─────────────────────────────────────────────────

/**
 * Return the caller's role name (lowercase) in a specific organization,
 * or null if they are not a member.
 * Bypass this check at the call-site when auth.role === "superAdmin".
 */
export async function getOrgMemberRole(
  db: DrizzleDB,
  userId: string,
  orgId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
    .limit(1);
  return row?.roleName?.toLowerCase() ?? null;
}

/**
 * Return the caller's effective role in a team.
 * With subteams removed this is equivalent to direct membership.
 */
export async function getEffectiveTeamRole(
  db: DrizzleDB,
  userId: string,
  teamId: number,
): Promise<string | null> {
  return getTeamMemberRole(db, userId, teamId);
}

/**
 * Return the caller's role name (lowercase) in a specific team,
 * or null if they are not a member.
 * Bypass this check at the call-site when auth.role === "superAdmin".
 */
export async function getTeamMemberRole(
  db: DrizzleDB,
  userId: string,
  teamId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ roleName: roles.name })
    .from(teamMembers)
    .innerJoin(roles, eq(teamMembers.roleId, roles.id))
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .limit(1);
  return row?.roleName?.toLowerCase() ?? null;
}

// ─── Server-side hooks for Better Auth integration ─────────────────────────────

/**
 * After a new user signs up, auto-create a personal organization
 * unless the user's plan is "member-only".
 */
export async function onUserCreated(
  db: DrizzleDB,
  userId: string,
  email: string,
  firstName?: string,
  lastName?: string,
): Promise<void> {
  // Find the "Owner" system role
  const ownerRole = await db.query.roles.findFirst({
    where: and(eq(roles.name, "Owner"), eq(roles.scope, "organization")),
  });
  if (!ownerRole) return;

  // Derive org name and slug from name or email
  const displayName = firstName
    ? lastName
      ? `${firstName} ${lastName}`
      : firstName
    : email.split("@")[0];
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const uniqueSlug = `${slug}-${Date.now()}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: `${displayName}'s Organization`,
      slug: uniqueSlug,
      ownerId: userId,
      status: "active",
    })
    .returning();

  // Add user as owner
  await db.insert(memberships).values({
    userId,
    orgId: org.id,
    roleId: ownerRole.id,
    isApproved: true,
    invitationStatus: "accepted",
    joinedAt: new Date(),
  });
}
