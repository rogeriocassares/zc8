/**
 * Roles Management API Routes
 */

import { count, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { requireAuth, type AuthContext } from "../db/auth";
import { memberships, roles, teamMembers } from "../db/schema";

export function createRoleRoutes(db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/roles" })
    .use(requireAuth())

    .get("/", async (ctx) => {
      const { scope } = ctx.query as { scope?: string };
      const conditions = scope ? eq(roles.scope, scope) : undefined;
      const result = await db
        .select()
        .from(roles)
        .where(conditions)
        .orderBy(roles.scope, roles.name);
      return { success: true, data: result, total: result.length };
    })

    .get("/:role_id", async (ctx) => {
      const roleId = Number.parseInt(ctx.params.role_id);
      const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId) });
      if (!role) return { success: false, error: "Role not found" };
      return { success: true, data: role };
    })

    .get("/scope/:scope", async (ctx) => {
      const { scope } = ctx.params;
      const result = await db.select().from(roles).where(eq(roles.scope, scope)).orderBy(roles.name);
      return { success: true, data: result, total: result.length };
    })

    .post(
      "/",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        if (auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Only super admins can create roles" };
        }
        const { name, scope, description, permissions } = ctx.body as {
          name: string; scope: string; description?: string; permissions?: Record<string, boolean>;
        };
        if (["Owner", "Admin", "Member"].includes(name)) {
          return { success: false, error: "Cannot create system roles" };
        }
        const [created] = await db
          .insert(roles)
          .values({ name, scope, description: description || null, permissions: permissions || {}, isSystemRole: false })
          .returning();
        return { success: true, data: created, message: "Role created successfully" };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 50 }),
          scope: t.String(),
          description: t.Optional(t.String()),
          permissions: t.Optional(t.Record(t.String(), t.Boolean())),
        }),
      },
    )

    .put(
      "/:role_id",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        if (auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Only super admins can modify roles" };
        }
        const roleId = Number.parseInt(ctx.params.role_id);
        const { description, permissions } = ctx.body as {
          description?: string; permissions?: Record<string, boolean>;
        };
        const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId), columns: { isSystemRole: true } });
        if (role?.isSystemRole) return { success: false, error: "Cannot modify system roles" };

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (description !== undefined) updates.description = description;
        if (permissions !== undefined) updates.permissions = permissions;

        const result = await db.update(roles).set(updates).where(eq(roles.id, roleId)).returning();
        return { success: true, data: result[0], message: "Role updated successfully" };
      },
      {
        body: t.Object({
          description: t.Optional(t.String()),
          permissions: t.Optional(t.Record(t.String(), t.Boolean())),
        }),
      },
    )

    .delete("/:role_id", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      if (auth.role !== "superAdmin") {
        ctx.set.status = 403;
        return { success: false, error: "Only super admins can delete roles" };
      }
      const roleId = Number.parseInt(ctx.params.role_id);
      const role = await db.query.roles.findFirst({ where: eq(roles.id, roleId), columns: { isSystemRole: true } });
      if (role?.isSystemRole) return { success: false, error: "Cannot delete system roles" };

      const [orgCount] = await db.select({ value: count() }).from(memberships).where(eq(memberships.roleId, roleId));
      const [teamCount] = await db.select({ value: count() }).from(teamMembers).where(eq(teamMembers.roleId, roleId));
      if (orgCount.value + teamCount.value > 0) {
        return { success: false, error: "Cannot delete role that is in use" };
      }
      await db.delete(roles).where(eq(roles.id, roleId));
      return { success: true, message: "Role deleted successfully" };
    })

    .get("/permissions/org", async () => ({
      success: true,
      data: {
        read: "Read organization data", write: "Edit organization configuration",
        delete: "Delete organization or critical data", admin: "Administrative access",
        manage_members: "Manage organization members", manage_teams: "Create and manage teams",
      },
    }))

    .get("/permissions/team", async () => ({
      success: true,
      data: {
        read: "Read team data", write: "Edit team configuration",
        delete: "Delete team (if authorized)", admin: "Team administrative access",
        manage_members: "Manage team members", create_subteams: "Create team hierarchies",
        create_devices: "Create and manage devices", monitor_devices: "Monitor team devices",
      },
    }));
}
