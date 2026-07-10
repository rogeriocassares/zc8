import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { schema } from "../db";
import {
  authenticateUser,
  authPlugin,
  generateToken,
  onUserCreated,
} from "../db/auth";
import type { AuthMiddleware } from "../lib/auth-middleware";

// ============================================================
// Drizzle-based auth routes — /api/auth/*
// ============================================================
export function createAuthRoutes(db: DrizzleDB) {
  return (
    new Elysia({ name: "auth-routes" })
      .use(authPlugin(db))
      // POST /api/auth/login
      .post(
        "/api/auth/login",
        async ({ body, set }) => {
          try {
            const { email, password } = body;
            if (!email || !password) {
              set.status = 400;
              return {
                error: "Email and password are required",
                message: "Email and password are required",
              };
            }
            const result = await authenticateUser(db, email, password);
            if (!result.success) {
              set.status = 401;
              return {
                error: result.error,
                message: result.error,
              };
            }
            return {
              userId: result.session.userId,
              email: result.session.email,
              platformRole: result.session.role,
              userPlan: result.session.userPlan,
              organizationId: result.session.orgId,
              organizationName: result.session.orgName,
              memberRole: result.session.memberRole,
              token: result.token,
              tokenExpires: result.expiresAt,
            };
          } catch (error) {
            console.error("Login error:", error);
            set.status = 500;
            return {
              error: "Internal server error",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            password: t.String({ minLength: 1 }),
          }),
        },
      )

      // POST /api/auth/signup
      .post(
        "/api/auth/signup",
        async ({ body, set }) => {
          try {
            const { email, password, first_name, last_name, plan } = body;

            const existing = await db.query.users.findFirst({
              where: eq(schema.users.email, email.toLowerCase()),
              columns: { id: true },
            });
            if (existing) {
              set.status = 409;
              return {
                error: "Email already in use",
                message: "Email already in use",
              };
            }

            const passwordHash = crypto
              .createHash("sha256")
              .update(password)
              .digest("hex");

            const [newUser] = await db
              .insert(schema.users)
              .values({
                email: email.toLowerCase(),
                passwordHash,
                firstName: first_name ?? null,
                lastName: last_name ?? null,
                role: "user",
                plan: plan ?? "hobby",
                isActive: true,
              })
              .returning();

            await onUserCreated(
              db,
              newUser.id,
              newUser.email,
              first_name,
              last_name,
            );

            const result = await authenticateUser(db, email, password);
            if (!result.success) {
              return { error: result.error, message: result.error };
            }

            return {
              userId: result.session.userId,
              email: result.session.email,
              platformRole: result.session.role,
              userPlan: result.session.userPlan,
              organizationId: result.session.orgId,
              organizationName: result.session.orgName,
              memberRole: result.session.memberRole,
              token: result.token,
              tokenExpires: result.expiresAt,
            };
          } catch (error) {
            console.error("Signup error:", error);
            return {
              error: "Internal server error",
              message: (error as Error).message,
              status: 500,
            };
          }
        },
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            password: t.String({ minLength: 8 }),
            first_name: t.Optional(t.String()),
            last_name: t.Optional(t.String()),
            plan: t.Optional(
              t.Union([
                t.Literal("hobby"),
                t.Literal("pro"),
                t.Literal("premium"),
                t.Literal("enterprise"),
              ]),
            ),
          }),
        },
      )

      // GET /api/auth/me
      .get("/api/auth/me", async ({ auth }) => {
        try {
          if (!auth) {
            return {
              error: "Unauthorized",
              message: "Invalid or missing token",
            };
          }
          const user = await db.query.users.findFirst({
            where: (u, { eq: e }) => e(u.id, auth.userId),
          });
          if (!user) {
            return { error: "User not found", message: "User not found" };
          }
          const userMemberships = await db
            .select({
              orgId: schema.organizations.id,
              orgName: schema.organizations.name,
              orgSlug: schema.organizations.slug,
              roleName: schema.roles.name,
            })
            .from(schema.memberships)
            .innerJoin(
              schema.organizations,
              eq(schema.memberships.orgId, schema.organizations.id),
            )
            .innerJoin(
              schema.roles,
              eq(schema.memberships.roleId, schema.roles.id),
            )
            .where(
              and(
                eq(schema.memberships.userId, auth.userId),
                eq(schema.organizations.status, "active"),
              ),
            )
            .orderBy(schema.memberships.createdAt);

          return {
            id: user.id,
            email: user.email,
            name:
              `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
              user.email,
            image: user.avatarUrl ?? null,
            organizations: userMemberships.map((m) => ({
              id: m.orgId,
              name: m.orgName,
              slug: m.orgSlug,
              role: m.roleName,
            })),
          };
        } catch (error) {
          console.error("Get user error:", error);
          return {
            error: "Internal server error",
            message: (error as Error).message,
          };
        }
      })

      // POST /api/auth/logout
      .post("/api/auth/logout", async () => {
        return { message: "Logged out successfully" };
      })

      // POST /api/auth/switch-org
      .post(
        "/api/auth/switch-org",
        async ({ auth, body }) => {
          try {
            if (!auth) {
              return {
                error: "Unauthorized",
                message: "Invalid or missing token",
                status: 401,
              };
            }
            const { organizationId } = body;
            const membership = await db
              .select({
                roleName: schema.roles.name,
                orgName: schema.organizations.name,
              })
              .from(schema.memberships)
              .innerJoin(
                schema.organizations,
                eq(schema.memberships.orgId, schema.organizations.id),
              )
              .innerJoin(
                schema.roles,
                eq(schema.memberships.roleId, schema.roles.id),
              )
              .where(
                and(
                  eq(schema.memberships.userId, auth.userId),
                  eq(schema.memberships.orgId, Number(organizationId)),
                  eq(schema.organizations.status, "active"),
                ),
              )
              .limit(1);

            if (membership.length === 0) {
              return {
                error: "Access denied",
                message: "User does not have access to this organization",
                status: 403,
              };
            }

            const m = membership[0];
            const memberRole = m.roleName.toLowerCase() as
              | "owner"
              | "admin"
              | "member";
            const { token, expiresAt } = generateToken({
              userId: auth.userId,
              email: auth.email,
              role: auth.role,
              userPlan: auth.userPlan,
              orgId: Number(organizationId),
              orgName: m.orgName,
              memberRole,
              scopes: auth.scopes,
            });

            return {
              userId: auth.userId,
              email: auth.email,
              userPlan: auth.userPlan,
              organizationId: Number(organizationId),
              organizationName: m.orgName,
              memberRole,
              token,
              tokenExpires: expiresAt,
            };
          } catch (error) {
            console.error("Switch organization error:", error);
            return {
              error: "Internal server error",
              message: (error as Error).message,
              status: 500,
            };
          }
        },
        {
          body: t.Object({
            organizationId: t.Union([t.Number(), t.BigInt()]),
          }),
        },
      )
  );
}

// ============================================================
// Legacy test-token auth routes — /auth/* (dev convenience only)
// ============================================================
export function createLegacyAuthRoutes(
  authMiddleware: AuthMiddleware,
  testTokens: {
    adminToken: string;
    imtOwnerToken: string;
    imtMemberToken: string;
    fsaeOwnerToken: string;
    storiocloudAdminToken: string;
    gmsTeamOwnerToken: string;
  },
) {
  return new Elysia({ name: "legacy-auth-routes" })
    .post("/auth/login", async ({ body }) => {
      const { email } = body as { email: string; password: string };

      if (email === "admin@platform.com") {
        const token = authMiddleware.generateUserToken(
          "f47ac10b-58cc-4372-a567-0e02b2c3d47a",
          email,
          1n,
          "Admin",
          "owner",
        );
        return { success: true, token, expiresIn: 86400 };
      }
      if (email === "imt@imt.com") {
        const token = authMiddleware.generateUserToken(
          "f47ac10b-58cc-4372-a567-0e02b2c3d480",
          email,
          2n,
          "IMT",
          "owner",
        );
        return { success: true, token, expiresIn: 86400 };
      }
      if (email === "gms@imt.com") {
        const token = authMiddleware.generateUserToken(
          "f47ac10b-58cc-4372-a567-0e02b2c3d481",
          email,
          2n,
          "IMT",
          "member",
        );
        return { success: true, token, expiresIn: 86400 };
      }
      return { success: false, error: "Invalid credentials" };
    })

    .get("/auth/verify", async ({ request }) => {
      const authHeader = request.headers.get("Authorization");
      const token = authMiddleware.extractTokenFromHeader(
        authHeader ?? undefined,
      );
      if (!token) return { success: false, error: "Missing token" };

      const payload = authMiddleware.validateToken(token);
      if (!payload) return { success: false, error: "Invalid token" };

      return {
        success: true,
        payload: {
          userId: payload.userId,
          email: payload.email,
          organizationId: payload.organizationId.toString(),
          organizationName: payload.organizationName,
          memberRole: payload.memberRole,
          scopes: payload.scopes,
        },
      };
    })

    .get("/auth/test-tokens", async () => {
      return {
        success: true,
        message: "Use these tokens for testing API endpoints",
        testTokens: {
          admin: testTokens.adminToken,
          imtOwner: testTokens.imtOwnerToken,
          imtMember: testTokens.imtMemberToken,
          fsaeOwner: testTokens.fsaeOwnerToken,
          storiocloudAdmin: testTokens.storiocloudAdminToken,
          gmsTeamOwner: testTokens.gmsTeamOwnerToken,
        },
        usage: "Add to Authorization header as: Authorization: Bearer <token>",
      };
    });
}
