/**
 * Teams Management API Routes
 */

import { and, count, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import {
  type AuthContext,
  getOrgMemberRole,
  getTeamMemberRole,
  requireAuth,
} from "../db/auth";
import {
  memberships,
  organizations,
  roles,
  teamMembers,
  teams,
  users,
} from "../db/schema";
import { getPlanConfig } from "./plan-config";

export function createGlobalTeamRoutes(db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/teams" })
    .use(requireAuth())
    .get("/", async () => {
      const result = await db
        .select({
          id: teams.id,
          name: teams.name,
          slug: teams.slug,
          description: teams.description,
          teamType: teams.teamType,
          status: teams.status,
          organizationId: teams.organizationId,
          createdAt: teams.createdAt,
          organizationName: organizations.name,
          integrationProfileId: teams.integrationProfileId,
        })
        .from(teams)
        .leftJoin(organizations, eq(teams.organizationId, organizations.id))
        .orderBy(teams.organizationId, teams.name);

      const ownerRows = await db
        .select({ teamId: teamMembers.teamId, email: users.email })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .innerJoin(roles, eq(teamMembers.roleId, roles.id))
        .where(eq(roles.name, "TeamOwner"));
      const ownerMap: Record<number, string> = {};
      for (const r of ownerRows) {
        if (r.teamId !== null && !ownerMap[r.teamId])
          ownerMap[r.teamId] = r.email;
      }

      const data = result.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        team_type: r.teamType,
        status: r.status,
        organization_id: r.organizationId,
        created_at: r.createdAt,
        organization_name: r.organizationName,
        owner_email: ownerMap[r.id] ?? null,
        integration_profile_id: r.integrationProfileId ?? null,
      }));
      return { success: true, data, total: data.length };
    });
}

export function createTeamRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1/orgs/:org_id/teams" })
      .use(requireAuth())

      .get("/", async (ctx) => {
        const orgId = Number.parseInt(ctx.params.org_id);
        const result = await db
          .select({
            id: teams.id,
            name: teams.name,
            slug: teams.slug,
            description: teams.description,
            teamType: teams.teamType,
            status: teams.status,
            createdAt: teams.createdAt,
            organizationName: organizations.name,
            integrationProfileId: teams.integrationProfileId,
          })
          .from(teams)
          .leftJoin(organizations, eq(teams.organizationId, organizations.id))
          .where(eq(teams.organizationId, orgId))
          .orderBy(teams.name);

        const teamIds = result.map((r) => r.id);
        const ownerMapOrg: Record<number, string> = {};
        if (teamIds.length > 0) {
          const ownerRowsOrg = await db
            .select({ teamId: teamMembers.teamId, email: users.email })
            .from(teamMembers)
            .innerJoin(users, eq(teamMembers.userId, users.id))
            .innerJoin(roles, eq(teamMembers.roleId, roles.id))
            .where(eq(roles.name, "TeamOwner"));
          for (const r of ownerRowsOrg) {
            if (r.teamId !== null && !ownerMapOrg[r.teamId])
              ownerMapOrg[r.teamId] = r.email;
          }
        }

        const data = result.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          team_type: r.teamType,
          status: r.status,
          created_at: r.createdAt,
          organization_id: orgId,
          organization_name: r.organizationName ?? null,
          owner_email: ownerMapOrg[r.id] ?? null,
          integration_profile_id: r.integrationProfileId ?? null,
        }));
        return { success: true, data, total: data.length };
      })

      .get("/:team_id", async (ctx) => {
        const { org_id, team_id } = ctx.params;
        const [team] = await db
          .select()
          .from(teams)
          .where(
            and(
              eq(teams.id, Number(team_id)),
              eq(teams.organizationId, Number(org_id)),
            ),
          )
          .limit(1);
        if (!team) return { success: false, error: "Team not found" };
        return { success: true, data: team };
      })

      .post(
        "/",
        async (ctx) => {
          const orgId = Number.parseInt(ctx.params.org_id);
          const { name, slug, description, team_type } = ctx.body as {
            name: string;
            slug: string;
            description?: string;
            team_type?: string;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const orgRole = await getOrgMemberRole(db, auth.userId, orgId);
            if (orgRole !== "owner" && orgRole !== "admin") {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "Only org owner or admin can create teams",
              };
            }
          }

          // Enforce plan-based team limits
          const org = await db.query.organizations.findFirst({
            where: eq(organizations.id, orgId),
            columns: { ownerId: true },
          });
          {
            const planOwnerId = org?.ownerId ?? auth.userId;
            const orgOwner = await db.query.users.findFirst({
              where: eq(users.id, planOwnerId as string),
              columns: { plan: true },
            });
            const ownerPlan = orgOwner?.plan ?? "hobby";
            const planCfg = await getPlanConfig(db, ownerPlan);

            if (planCfg.maxTeamsPerOrg === 0) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "Your plan does not allow creating teams",
              };
            }
            if (planCfg.maxTeamsPerOrg > 0) {
              const [{ value: teamCount }] = await db
                .select({ value: count() })
                .from(teams)
                .where(eq(teams.organizationId, orgId));
              if (teamCount >= planCfg.maxTeamsPerOrg) {
                (ctx as unknown as { set: { status: number } }).set.status =
                  403;
                return {
                  success: false,
                  error: `Team limit reached for this organization's plan (${teamCount}/${planCfg.maxTeamsPerOrg})`,
                };
              }
            }
          }

          const [created] = await db
            .insert(teams)
            .values({
              organizationId: orgId,
              name,
              slug,
              description: description || null,
              teamType: team_type || "department",
              status: "active",
            })
            .returning();

          // Auto-add creator as TeamOwner member and all org owners/admins as TeamOwner
          const teamOwnerRole = await db.query.roles.findFirst({
            where: and(eq(roles.name, "TeamOwner"), eq(roles.scope, "team")),
          });
          if (teamOwnerRole) {
            // Find all org members with Owner or Admin role
            const orgOwnerRole = await db.query.roles.findFirst({
              where: and(
                eq(roles.name, "Owner"),
                eq(roles.scope, "organization"),
              ),
            });
            const orgAdminRole = await db.query.roles.findFirst({
              where: and(
                eq(roles.name, "Admin"),
                eq(roles.scope, "organization"),
              ),
            });
            const orgRoleIds: number[] = [];
            if (orgOwnerRole) orgRoleIds.push(orgOwnerRole.id);
            if (orgAdminRole) orgRoleIds.push(orgAdminRole.id);

            const orgAdmins =
              orgRoleIds.length > 0
                ? await db
                  .select({ userId: memberships.userId })
                  .from(memberships)
                  .where(
                    and(
                      eq(memberships.orgId, orgId),
                      inArray(memberships.roleId, orgRoleIds),
                    ),
                  )
                : [];

            // Collect unique user IDs (include creator in case they are not yet in org owners list)
            const userIdsToAdd = [
              ...new Set([
                auth.userId,
                ...(orgAdmins.map((m) => m.userId).filter(Boolean) as string[]),
              ]),
            ];

            await db
              .insert(teamMembers)
              .values(
                userIdsToAdd.map((userId) => ({
                  userId,
                  teamId: created.id,
                  roleId: teamOwnerRole.id,
                  invitationStatus: "accepted" as const,
                  joinedAt: new Date(),
                })),
              )
              .onConflictDoNothing();
          }

          return {
            success: true,
            data: created,
            message: "Team created successfully",
          };
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1, maxLength: 255 }),
            slug: t.String({ minLength: 1, maxLength: 255 }),
            description: t.Optional(t.String()),
            team_type: t.Optional(t.String()),
          }),
        },
      )

      .put(
        "/:team_id",
        async (ctx) => {
          const { org_id, team_id } = ctx.params;
          const { name, description, status, integration_profile_id } = ctx.body as {
            name?: string;
            description?: string;
            status?: string;
            integration_profile_id?: number | null;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const teamRole = await getTeamMemberRole(
              db,
              auth.userId,
              Number(team_id),
            );
            const orgRole = await getOrgMemberRole(
              db,
              auth.userId,
              Number(org_id),
            );
            const canEdit =
              teamRole === "teamowner" ||
              teamRole === "teamadmin" ||
              orgRole === "owner";
            if (!canEdit) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "TeamOwner, TeamAdmin or OrgOwner access required",
              };
            }
          }
          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (name !== undefined) updates.name = name;
          if (description !== undefined) updates.description = description;
          if (status !== undefined) updates.status = status;
          if (integration_profile_id !== undefined)
            updates.integrationProfileId = integration_profile_id;

          const result = await db
            .update(teams)
            .set(updates)
            .where(
              and(
                eq(teams.id, Number(team_id)),
                eq(teams.organizationId, Number(org_id)),
              ),
            )
            .returning();
          return {
            success: true,
            data: result[0],
            message: "Team updated successfully",
          };
        },
        {
          body: t.Object({
            name: t.Optional(t.String()),
            description: t.Optional(t.String()),
            status: t.Optional(t.String()),
            integration_profile_id: t.Optional(t.Nullable(t.Number())),
          }),
        },
      )

      .delete("/:team_id", async (ctx) => {
        const { org_id, team_id } = ctx.params;
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        if (auth.role !== "superAdmin") {
          const teamRole = await getTeamMemberRole(
            db,
            auth.userId,
            Number(team_id),
          );
          const orgRole = await getOrgMemberRole(
            db,
            auth.userId,
            Number(org_id),
          );
          const canDelete = teamRole === "teamowner" || orgRole === "owner";
          if (!canDelete) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error: "TeamOwner or OrgOwner access required to delete team",
            };
          }
        }
        await db
          .delete(teams)
          .where(
            and(
              eq(teams.id, Number(team_id)),
              eq(teams.organizationId, Number(org_id)),
            ),
          );
        return { success: true, message: "Team deleted successfully" };
      })

      // ============================================================
      // Team Members
      // ============================================================

      .get("/:team_id/members", async (ctx) => {
        const { team_id } = ctx.params;
        const members = await db
          .select({
            id: teamMembers.id,
            userId: teamMembers.userId,
            roleId: teamMembers.roleId,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            roleName: roles.name,
            joinedAt: teamMembers.joinedAt,
            invitationStatus: teamMembers.invitationStatus,
          })
          .from(teamMembers)
          .innerJoin(users, eq(teamMembers.userId, users.id))
          .innerJoin(roles, eq(teamMembers.roleId, roles.id))
          .where(eq(teamMembers.teamId, Number(team_id)))
          .orderBy(teamMembers.joinedAt);

        const data = members.map((m) => ({
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
        "/:team_id/members",
        async (ctx) => {
          const { team_id, org_id } = ctx.params;
          const { user_id, role_id } = ctx.body as {
            user_id: string;
            role_id: number;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const teamRole = await getTeamMemberRole(
              db,
              auth.userId,
              Number(team_id),
            );
            const orgRole = await getOrgMemberRole(
              db,
              auth.userId,
              Number(org_id),
            );
            const canManage =
              teamRole === "teamowner" ||
              teamRole === "teamadmin" ||
              orgRole === "owner" ||
              orgRole === "admin";
            if (!canManage) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error:
                  "TeamOwner, TeamAdmin, OrgOwner or OrgAdmin access required",
              };
            }
          }
          const role = await db.query.roles.findFirst({
            where: and(eq(roles.id, role_id), eq(roles.scope, "team")),
          });
          if (!role)
            return { success: false, error: "Invalid team-scoped role" };

          const [created] = await db
            .insert(teamMembers)
            .values({
              teamId: Number(team_id),
              userId: user_id,
              roleId: role_id,
              invitationStatus: "accepted",
              joinedAt: new Date(),
            })
            .onConflictDoNothing()
            .returning();
          if (!created)
            return { success: false, error: "Member already exists in team" };
          return {
            success: true,
            data: created,
            message: "Member added to team successfully",
          };
        },
        { body: t.Object({ user_id: t.String(), role_id: t.Number() }) },
      )

      .put(
        "/:team_id/members/:member_id",
        async (ctx) => {
          const { team_id, member_id, org_id } = ctx.params;
          const { role_id } = ctx.body as { role_id: number };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const teamRole = await getTeamMemberRole(
              db,
              auth.userId,
              Number(team_id),
            );
            const orgRole = await getOrgMemberRole(
              db,
              auth.userId,
              Number(org_id),
            );
            const canManage = teamRole === "teamowner" || orgRole === "owner";
            if (!canManage) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error:
                  "TeamOwner or OrgOwner access required to change member roles",
              };
            }
          }
          const result = await db
            .update(teamMembers)
            .set({ roleId: role_id, updatedAt: new Date() })
            .where(
              and(
                eq(teamMembers.id, Number(member_id)),
                eq(teamMembers.teamId, Number(team_id)),
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

      .delete("/:team_id/members/:member_id", async (ctx) => {
        const { team_id, member_id, org_id } = ctx.params;
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        if (auth.role !== "superAdmin") {
          const teamRole = await getTeamMemberRole(
            db,
            auth.userId,
            Number(team_id),
          );
          const orgRole = await getOrgMemberRole(
            db,
            auth.userId,
            Number(org_id),
          );
          const canRemove =
            teamRole === "teamowner" ||
            teamRole === "teamadmin" ||
            orgRole === "owner" ||
            orgRole === "admin";
          if (!canRemove) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error:
                "TeamOwner, TeamAdmin, OrgOwner or OrgAdmin access required",
            };
          }
        }
        await db
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.id, Number(member_id)),
              eq(teamMembers.teamId, Number(team_id)),
            ),
          );
        return { success: true, message: "Member removed from team" };
      })
  );
}
