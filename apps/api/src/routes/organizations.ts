/**
 * Organizations Management API Routes
 *
 * Endpoints for managing:
 * - Organizations (flat — no parent/child hierarchy)
 * - Organization members with RBAC
 */

import { and, count, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, getOrgMemberRole, requireAuth } from "../db/auth";
import {
  memberships,
  organizations,
  roles,
  teams,
  users,
} from "../db/schema";
import { getPlanConfig } from "./plan-config";

const ownerUser = alias(users, "owner_user");

export function createOrganizationRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1/organizations" })
      .use(requireAuth())

      .get("/", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        let orgs;
        if (auth.role === "superAdmin") {
          orgs = await db
            .select({
              id: organizations.id,
              name: organizations.name,
              slug: organizations.slug,
              description: organizations.description,
              status: organizations.status,
              ownerEmail: ownerUser.email,
            })
            .from(organizations)
            .leftJoin(ownerUser, eq(organizations.ownerId, ownerUser.id))
            .orderBy(organizations.id);
        } else {
          orgs = await db
            .select({
              id: organizations.id,
              name: organizations.name,
              slug: organizations.slug,
              description: organizations.description,
              status: organizations.status,
              ownerEmail: ownerUser.email,
            })
            .from(organizations)
            .leftJoin(ownerUser, eq(organizations.ownerId, ownerUser.id))
            .innerJoin(memberships, eq(memberships.orgId, organizations.id))
            .where(eq(memberships.userId, auth.userId))
            .orderBy(organizations.id);
        }

        const data = orgs.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          description: o.description,
          status: o.status,
          owner_email: o.ownerEmail,
        }));

        return { success: true, data, total: data.length };
      })

      .get("/:org_id", async (ctx) => {
        const orgId = Number.parseInt(ctx.params.org_id);
        const org = await db.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
        });
        if (!org) return { success: false, error: "Organization not found" };
        return { success: true, data: org };
      })

      .post(
        "/",
        async (ctx) => {
          const { name, slug, description } = ctx.body as {
            name: string;
            slug: string;
            description?: string;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          // Enforce plan-based org limit (superAdmin is exempt).
          // Any authenticated user may create orgs — plan.maxOrgs governs how many.
          // plan "user" (base tier) has maxOrgs = 0, which blocks org creation below.
          if (auth.role !== "superAdmin") {
            const caller = await db.query.users.findFirst({
              where: eq(users.id, auth.userId),
              columns: { plan: true },
            });
            const callerPlan = caller?.plan ?? "user";
            const planCfg = await getPlanConfig(db, callerPlan);

            if (planCfg.maxOrgs === 0) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "Your plan does not allow creating organizations. Upgrade your plan to get started.",
              };
            }

            if (planCfg.maxOrgs > 0) {
              const [{ value: ownedCount }] = await db
                .select({ value: count() })
                .from(organizations)
                .where(eq(organizations.ownerId, auth.userId));
              if (ownedCount >= planCfg.maxOrgs) {
                (ctx as unknown as { set: { status: number } }).set.status =
                  403;
                return {
                  success: false,
                  error: `Organization limit reached for your plan (${ownedCount}/${planCfg.maxOrgs})`,
                };
              }
            }
          }

          const [created] = await db
            .insert(organizations)
            .values({
              name,
              slug,
              description: description || null,
              status: "active",
              ownerId: auth.userId,
            })
            .returning();

          // Auto-add creator as Owner member
          const ownerRole = await db.query.roles.findFirst({
            where: and(
              eq(roles.name, "Owner"),
              eq(roles.scope, "organization"),
            ),
          });
          if (ownerRole) {
            await db
              .insert(memberships)
              .values({
                userId: auth.userId,
                orgId: created.id,
                roleId: ownerRole.id,
                isApproved: true,
                invitationStatus: "accepted",
                joinedAt: new Date(),
              })
              .onConflictDoNothing();
          }

          return {
            success: true,
            data: created,
            message: "Organization created successfully",
          };
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1, maxLength: 255 }),
            slug: t.String({ minLength: 1, maxLength: 255 }),
            description: t.Optional(t.String()),
          }),
        },
      )

      .put(
        "/:org_id",
        async (ctx) => {
          const orgId = Number.parseInt(ctx.params.org_id);
          const {
            name,
            description,
            status,
            plan,
            owner_id,
            domain,
            logo_url,
          } = ctx.body as {
            name?: string;
            description?: string;
            status?: string;
            plan?: string;
            owner_id?: string;
            domain?: string;
            logo_url?: string;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const callerRole = await getOrgMemberRole(db, auth.userId, orgId);
            if (callerRole !== "owner") {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "Organization owner access required",
              };
            }
          }

          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (name !== undefined) updates.name = name;
          if (description !== undefined) updates.description = description;
          if (status !== undefined) updates.status = status;
          if (owner_id !== undefined) updates.ownerId = owner_id;
          if (domain !== undefined) updates.domain = domain;
          if (logo_url !== undefined) updates.logoUrl = logo_url;

          // Downgrade validation for org plan change
          if (plan !== undefined) {
            const existingOrg = await db.query.organizations.findFirst({
              where: eq(organizations.id, orgId),
              columns: {
                domain: true,
                logoUrl: true,
                ownerId: true,
              },
            });
            const currentPlan = (existingOrg as any)?.plan ?? "hobby";
            const PLAN_ORDER: Record<string, number> = {
              user: 0,
              hobby: 1,
              pro: 2,
              premium: 3,
              enterprise: 4,
            };
            const isDowngrade =
              (PLAN_ORDER[plan] ?? 0) < (PLAN_ORDER[currentPlan] ?? 0);

            if (isDowngrade) {
              const newCfg = await getPlanConfig(
                db,
                plan as import("../db/schema").Plan,
              );
              const violations: string[] = [];

              // enterprise downgrade: check domain/logo
              if (currentPlan === "enterprise" && plan !== "enterprise") {
                if (existingOrg?.domain || existingOrg?.logoUrl) {
                  violations.push(
                    "Remove the custom domain and logo before downgrading from Enterprise",
                  );
                }
              }

              // Check team count
              if (newCfg.maxTeamsPerOrg >= 0) {
                const [{ value: topCount }] = await db
                  .select({ value: count() })
                  .from(teams)
                  .where(eq(teams.organizationId, orgId));
                if (newCfg.maxTeamsPerOrg === 0 && topCount > 0) {
                  violations.push(
                    `This organization has ${topCount} team(s) — remove them before downgrading to "${plan}"`,
                  );
                } else if (
                  newCfg.maxTeamsPerOrg > 0 &&
                  topCount > newCfg.maxTeamsPerOrg
                ) {
                  violations.push(
                    `This organization has ${topCount} teams but "${plan}" allows only ${newCfg.maxTeamsPerOrg}`,
                  );
                }
              }

              if (violations.length > 0) {
                (ctx as unknown as { set: { status: number } }).set.status =
                  422;
                return { success: false, error: violations.join("; ") };
              }
            }
            updates.plan = plan;
          }

          const result = await db
            .update(organizations)
            .set(updates)
            .where(eq(organizations.id, orgId))
            .returning();

          return {
            success: true,
            data: result[0],
            message: "Organization updated successfully",
          };
        },
        {
          body: t.Object({
            name: t.Optional(t.String()),
            description: t.Optional(t.String()),
            status: t.Optional(t.String()),
            plan: t.Optional(t.String()),
            owner_id: t.Optional(t.String()),
            domain: t.Optional(t.String()),
            logo_url: t.Optional(t.String()),
          }),
        },
      )

      .delete("/:org_id", async (ctx) => {
        const orgId = Number.parseInt(ctx.params.org_id);
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        if (auth.role !== "superAdmin") {
          const callerRole = await getOrgMemberRole(db, auth.userId, orgId);
          if (callerRole !== "owner") {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error: "Organization owner access required",
            };
          }
        }
        await db.delete(memberships).where(eq(memberships.orgId, orgId));
        await db.delete(organizations).where(eq(organizations.id, orgId));
        return { success: true, message: "Organization deleted successfully" };
      })

      // ============================================================
      // Organization Members Endpoints
      // ============================================================

      .get("/:org_id/members", async (ctx) => {
        const orgId = Number.parseInt(ctx.params.org_id);
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        const members = await db
          .select({
            id: memberships.id,
            userId: memberships.userId,
            roleId: memberships.roleId,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            roleName: roles.name,
            joinedAt: memberships.joinedAt,
            invitationStatus: memberships.invitationStatus,
            userRole: users.role,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .innerJoin(roles, eq(memberships.roleId, roles.id))
          .where(eq(memberships.orgId, orgId))
          .orderBy(memberships.joinedAt);

        // Non-superAdmin callers must not see superAdmin accounts in member lists
        const visible =
          auth.role !== "superAdmin"
            ? members.filter((m) => m.userRole !== "superAdmin")
            : members;

        const data = visible.map((m) => ({
          id: m.id,
          user_id: m.userId,
          role_id: m.roleId,
          email: m.email,
          first_name: m.firstName,
          last_name: m.lastName,
          role_name: m.roleName,
          joined_at: m.joinedAt,
          invitation_status: m.invitationStatus,
        }));

        return { success: true, data, total: data.length };
      })

      .post(
        "/:org_id/members",
        async (ctx) => {
          const orgId = Number.parseInt(ctx.params.org_id);
          const { user_id, role_id } = ctx.body as {
            user_id: string;
            role_id: number;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const callerRole = await getOrgMemberRole(db, auth.userId, orgId);
            if (callerRole !== "owner" && callerRole !== "admin") {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "Organization owner or admin access required",
              };
            }
          }

          const role = await db.query.roles.findFirst({
            where: and(eq(roles.id, role_id), eq(roles.scope, "organization")),
          });
          if (!role)
            return {
              success: false,
              error: "Invalid organization-scoped role",
            };

          const [created] = await db
            .insert(memberships)
            .values({
              orgId: orgId,
              userId: user_id,
              roleId: role_id,
              isApproved: true,
              invitationStatus: "accepted",
              joinedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning();

          if (!created)
            return {
              success: false,
              error: "Member already exists in organization",
            };
          return {
            success: true,
            data: created,
            message: "Member added to organization successfully",
          };
        },
        { body: t.Object({ user_id: t.String(), role_id: t.Number() }) },
      )

      .put(
        "/:org_id/members/:member_id",
        async (ctx) => {
          const { org_id, member_id } = ctx.params;
          const { role_id } = ctx.body as { role_id: number };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const callerRole = await getOrgMemberRole(
              db,
              auth.userId,
              Number(org_id),
            );
            if (callerRole !== "owner") {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "Organization owner access required to change roles",
              };
            }
          }

          const result = await db
            .update(memberships)
            .set({ roleId: role_id, updatedAt: new Date() })
            .where(
              and(
                eq(memberships.id, Number(member_id)),
                eq(memberships.orgId, Number(org_id)),
              ),
            )
            .returning();

          return {
            success: true,
            data: result[0],
            message: "Member role updated successfully",
          };
        },
        { body: t.Object({ role_id: t.Number() }) },
      )

      .delete("/:org_id/members/:member_id", async (ctx) => {
        const { org_id, member_id } = ctx.params;
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        if (auth.role !== "superAdmin") {
          const callerRole = await getOrgMemberRole(
            db,
            auth.userId,
            Number(org_id),
          );
          if (callerRole !== "owner" && callerRole !== "admin") {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error: "Organization owner or admin access required",
            };
          }
        }
        // Protect the org owner: only themselves or a superAdmin can remove them
        const [orgRow, memberRow] = await Promise.all([
          db.query.organizations.findFirst({
            where: eq(organizations.id, Number(org_id)),
            columns: { ownerId: true },
          }),
          db.query.memberships.findFirst({
            where: and(
              eq(memberships.id, Number(member_id)),
              eq(memberships.orgId, Number(org_id)),
            ),
            columns: { userId: true },
          }),
        ]);
        if (
          orgRow?.ownerId &&
          memberRow?.userId === orgRow.ownerId &&
          auth.role !== "superAdmin" &&
          auth.userId !== orgRow.ownerId
        ) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return {
            success: false,
            error:
              "Organization owner can only be removed by themselves or a superAdmin",
          };
        }
        await db
          .delete(memberships)
          .where(
            and(
              eq(memberships.id, Number(member_id)),
              eq(memberships.orgId, Number(org_id)),
            ),
          );
        return { success: true, message: "Member removed from organization" };
      })
  );
}
