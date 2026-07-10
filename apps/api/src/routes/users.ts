/**
 * Users Management API Routes
 *
 * Endpoints for listing and managing platform users.
 * Intended for admin/org-admin use.
 */

import * as crypto from "crypto";
import { and, count, eq, ne, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import type { Plan } from "../db/schema";
import {
  memberships,
  organizations,
  teamMembers,
  teams,
  users,
} from "../db/schema";
import { getPlanConfig } from "./plan-config";

const PLAN_ORDER: Record<Plan, number> = {
  user: 0, hobby: 1, pro: 2, premium: 3, enterprise: 4,
};

export function createUserRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1/users" })
      .use(requireAuth())

      // List all users with their org and team memberships
      .get("/", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        type UserRow = {
          id: string;
          email: string;
          firstName: string | null;
          lastName: string | null;
          role: string | null;
          plan: string | null;
          avatarUrl: string | null;
          createdAt: Date | null;
          emailVerified: boolean | null;
          isActive: boolean | null;
        };

        // superAdmins see all users; others see themselves + their org's members
        let allUsers: UserRow[];
        if (auth.role === "superAdmin") {
          allUsers = await db.select().from(users).orderBy(users.id);
        } else if (auth.orgId) {
          // Users in the same org, excluding superAdmins, deduped via DISTINCT on id
          allUsers = await db
            .selectDistinct({
              id: users.id,
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
              role: users.role,
              plan: users.plan,
              avatarUrl: users.avatarUrl,
              createdAt: users.createdAt,
              emailVerified: users.emailVerified,
              isActive: users.isActive,
            })
            .from(users)
            .leftJoin(memberships, eq(memberships.userId, users.id))
            .where(
              and(
                ne(users.role, "superAdmin"),
                or(
                  eq(users.id, auth.userId),
                  eq(memberships.orgId, auth.orgId),
                ),
              ),
            )
            .orderBy(users.id);
        } else {
          // No org — show only themselves
          allUsers = await db
            .select({
              id: users.id,
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
              role: users.role,
              plan: users.plan,
              avatarUrl: users.avatarUrl,
              createdAt: users.createdAt,
              emailVerified: users.emailVerified,
              isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, auth.userId))
            .orderBy(users.id);
        }

        const result = await Promise.all(
          allUsers.map(async (u) => {
            const orgs = await db
              .select({ id: organizations.id, name: organizations.name })
              .from(memberships)
              .innerJoin(organizations, eq(memberships.orgId, organizations.id))
              .where(eq(memberships.userId, u.id));

            const userTeams = await db
              .select({ id: teams.id, name: teams.name })
              .from(teamMembers)
              .innerJoin(teams, eq(teamMembers.teamId, teams.id))
              .where(eq(teamMembers.userId, u.id));

            return {
              id: u.id,
              email: u.email,
              first_name: "firstName" in u ? u.firstName : null,
              last_name: "lastName" in u ? u.lastName : null,
              role: "role" in u ? u.role : "user",
              plan: "plan" in u ? u.plan : "user",
              avatar_url: "avatarUrl" in u ? u.avatarUrl : null,
              created_at: u.createdAt,
              email_verified: "emailVerified" in u ? u.emailVerified : null,
              is_active: "isActive" in u ? u.isActive : null,
              organizations: orgs,
              teams: userTeams,
            };
          }),
        );

        return { success: true, data: result, total: result.length };
      })

      // Get a single user by id
      .get("/:user_id", async (ctx) => {
        const user = await db.query.users.findFirst({
          where: eq(users.id, ctx.params.user_id),
        });
        if (!user) return { success: false, error: "User not found" };
        return {
          success: true,
          data: {
            id: user.id,
            email: user.email,
            first_name: user.firstName,
            last_name: user.lastName,
            avatar_url: user.avatarUrl,
            created_at: user.createdAt,
          },
        };
      })

      // Invite / create a user (hashes password server-side)
      .post(
        "/",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          if (auth.role !== "superAdmin") {
            ctx.set.status = 403;
            return {
              success: false,
              error: "Only super admins can create users",
            };
          }

          const {
            email,
            first_name,
            last_name,
            password,
            email_verified,
            is_active,
          } = ctx.body as {
            email: string;
            first_name: string;
            last_name: string;
            password: string;
            email_verified?: boolean;
            is_active?: boolean;
          };

          const existing = await db.query.users.findFirst({
            where: eq(users.email, email.toLowerCase()),
          });
          if (existing) {
            return { success: false, error: "Email already registered" };
          }

          const passwordHash = crypto
            .createHash("sha256")
            .update(password)
            .digest("hex");

          const [created] = await db
            .insert(users)
            .values({
              email: email.toLowerCase(),
              firstName: first_name,
              lastName: last_name,
              passwordHash,
              emailVerified: email_verified ?? false,
              isActive: is_active ?? true,
            })
            .returning({
              id: users.id,
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
              avatarUrl: users.avatarUrl,
              createdAt: users.createdAt,
              emailVerified: users.emailVerified,
              isActive: users.isActive,
            });

          return {
            success: true,
            data: {
              id: created.id,
              email: created.email,
              first_name: created.firstName,
              last_name: created.lastName,
              avatar_url: created.avatarUrl,
              created_at: created.createdAt,
              email_verified: created.emailVerified,
              is_active: created.isActive,
            },
            message: "User created successfully",
          };
        },
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            first_name: t.String({ minLength: 1 }),
            last_name: t.String({ minLength: 1 }),
            password: t.String({ minLength: 8 }),
            email_verified: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
          }),
        },
      )

      // Update user profile
      .put(
        "/:user_id",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const { first_name, last_name, avatar_url, plan, role, email_verified, is_active } =
            ctx.body as {
              first_name?: string;
              last_name?: string;
              avatar_url?: string;
              plan?: Plan;
              role?: "superAdmin" | "admin" | "user";
              email_verified?: boolean;
              is_active?: boolean;
            };

          // Only superAdmins can change role
          if (role !== undefined && auth.role !== "superAdmin") {
            ctx.set.status = 403;
            return {
              success: false,
              error: "Only super admins can change user roles",
            };
          }

          // Only superAdmins can change another user's plan; admins may update their own
          if (
            plan !== undefined &&
            auth.role !== "superAdmin" &&
            auth.userId !== ctx.params.user_id
          ) {
            ctx.set.status = 403;
            return {
              success: false,
              error: "You can only change your own plan",
            };
          }

          // Downgrade validation: block if usage exceeds the new plan's limits
          if (plan !== undefined) {
            const targetUser = await db.query.users.findFirst({
              where: eq(users.id, ctx.params.user_id),
              columns: { plan: true },
            });
            const currentPlan = targetUser?.plan ?? "user";
            const isDowngrade = PLAN_ORDER[plan] < PLAN_ORDER[currentPlan];

            if (isDowngrade) {
              const newCfg = await getPlanConfig(db, plan);
              const userId = ctx.params.user_id;
              const violations: string[] = [];

              // Count orgs owned by the user
              const [{ value: ownedOrgCount }] = await db
                .select({ value: count() })
                .from(organizations)
                .where(eq(organizations.ownerId, userId));

              if (newCfg.maxOrgs === 0 && ownedOrgCount > 0) {
                violations.push(`You must remove all organizations before downgrading to "${plan}" (owns ${ownedOrgCount})`);
              } else if (newCfg.maxOrgs > 0 && ownedOrgCount > newCfg.maxOrgs) {
                violations.push(`You own ${ownedOrgCount} organizations but "${plan}" allows only ${newCfg.maxOrgs}`);
              }

              if (violations.length === 0 && ownedOrgCount > 0) {
                // Fetch all owned orgs to check team/subteam limits
                const ownedOrgs = await db
                  .select({ id: organizations.id, domain: organizations.domain, logoUrl: organizations.logoUrl })
                  .from(organizations)
                  .where(eq(organizations.ownerId, userId));

                // Enterprise → premium: block if any org has domain or logo set
                if (currentPlan === "enterprise" && plan !== "enterprise") {
                  for (const org of ownedOrgs) {
                    if (org.domain || org.logoUrl) {
                      violations.push(`Organization #${org.id} has a custom domain or logo set — remove them before downgrading from Enterprise`);
                    }
                  }
                }

                // Check team counts per org against the new plan limit
                if (newCfg.maxTeamsPerOrg >= 0) {
                  for (const org of ownedOrgs) {
                    const [{ value: topTeamCount }] = await db
                      .select({ value: count() })
                      .from(teams)
                      .where(eq(teams.organizationId, org.id));
                    if (newCfg.maxTeamsPerOrg === 0 && topTeamCount > 0) {
                      violations.push(`Organization #${org.id} has ${topTeamCount} team(s) — remove them before downgrading to "${plan}"`);
                    } else if (newCfg.maxTeamsPerOrg > 0 && topTeamCount > newCfg.maxTeamsPerOrg) {
                      violations.push(`Organization #${org.id} has ${topTeamCount} teams but "${plan}" allows only ${newCfg.maxTeamsPerOrg}`);
                    }
                  }
                }
              }

              if (violations.length > 0) {
                ctx.set.status = 422;
                return { success: false, error: violations.join("; ") };
              }
            }
          }

          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (first_name !== undefined) updates.firstName = first_name;
          if (last_name !== undefined) updates.lastName = last_name;
          if (avatar_url !== undefined) updates.avatarUrl = avatar_url;
          if (plan !== undefined) updates.plan = plan;
          if (role !== undefined) updates.role = role;
          if (email_verified !== undefined) updates.emailVerified = email_verified;
          if (is_active !== undefined) updates.isActive = is_active;

          const result = await db
            .update(users)
            .set(updates)
            .where(eq(users.id, ctx.params.user_id))
            .returning({
              id: users.id,
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
              avatarUrl: users.avatarUrl,
              plan: users.plan,
              role: users.role,
              createdAt: users.createdAt,
              emailVerified: users.emailVerified,
              isActive: users.isActive,
            });

          if (!result.length)
            return { success: false, error: "User not found" };
          return {
            success: true,
            data: {
              id: result[0].id,
              email: result[0].email,
              first_name: result[0].firstName,
              last_name: result[0].lastName,
              avatar_url: result[0].avatarUrl,
              plan: result[0].plan,
              role: result[0].role,
              created_at: result[0].createdAt,
              email_verified: result[0].emailVerified,
              is_active: result[0].isActive,
            },
            message: "User updated",
          };
        },
        {
          body: t.Object({
            first_name: t.Optional(t.String()),
            last_name: t.Optional(t.String()),
            avatar_url: t.Optional(t.String()),
            plan: t.Optional(
              t.Union([
                t.Literal("user"),
                t.Literal("hobby"),
                t.Literal("pro"),
                t.Literal("premium"),
                t.Literal("enterprise"),
              ]),
            ),
            role: t.Optional(
              t.Union([t.Literal("superAdmin"), t.Literal("user")]),
            ),
            email_verified: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
          }),
        },
      )

      // Delete user
      .delete("/:user_id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        if (auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return {
            success: false,
            error: "Only superAdmin can delete users",
          };
        }

        const target = await db.query.users.findFirst({
          where: eq(users.id, ctx.params.user_id),
        });
        if (!target) {
          ctx.set.status = 404;
          return { success: false, error: "User not found" };
        }

        // Block deletion if the user still belongs to any organization.
        const [{ value: memberCount }] = await db
          .select({ value: count() })
          .from(memberships)
          .where(eq(memberships.userId, ctx.params.user_id));
        if (memberCount > 0) {
          ctx.set.status = 409;
          return {
            success: false,
            error: `Cannot delete: user is a member of ${memberCount} organization(s). Remove from all organizations first.`,
          };
        }

        await db.delete(users).where(eq(users.id, ctx.params.user_id));
        return { success: true, message: "User deleted" };
      })
  );
}
