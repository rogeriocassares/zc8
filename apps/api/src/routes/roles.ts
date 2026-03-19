/**
 * Roles Management API Routes
 *
 * Endpoints for managing:
 * - System roles (organization and team scopes)
 * - Role-based access control definitions
 * - Permission configurations
 */

import { Elysia, t } from "elysia";
import type { Database } from "../lib/adapter-types";

export function createRoleRoutes(db: Database) {
  return new Elysia({ prefix: "/api/v1/roles" })
    // ============================================================
    // Role CRUD Endpoints
    // ============================================================

    .get("/", async (ctx) => {
      const { scope } = ctx.query as { scope?: string };
      let query = "SELECT * FROM roles";
      const params: any[] = [];

      if (scope) {
        query += " WHERE scope = $1";
        params.push(scope);
      }

      query += " ORDER BY scope, name";

      const roles = await db.query(query, params);
      return {
        success: true,
        data: roles,
        total: roles.length,
      };
    })

    .get("/:role_id", async (ctx) => {
      const role_id = Number.parseInt(ctx.params.role_id);
      const role = await db.queryOne(
        "SELECT * FROM roles WHERE id = $1",
        [role_id]
      );
      if (!role) {
        return { success: false, error: "Role not found" };
      }
      return { success: true, data: role };
    })

    .get("/scope/:scope", async (ctx) => {
      const { scope } = ctx.params;
      const roles = await db.query(
        "SELECT * FROM roles WHERE scope = $1 ORDER BY name",
        [scope]
      );
      return {
        success: true,
        data: roles,
        total: roles.length,
      };
    })

    .post(
      "/",
      async (ctx) => {
        const { name, scope, description, permissions } = ctx.body as any;

        // System roles cannot be created via API
        if (
          ["Owner", "Admin", "Member"].includes(name)
        ) {
          return {
            success: false,
            error: "Cannot create system roles",
          };
        }

        const result = await db.query(
          `INSERT INTO roles (name, scope, description, permissions, is_system_role)
           VALUES ($1, $2, $3, $4, false)
           RETURNING *`,
          [name, scope, description, JSON.stringify(permissions || {})]
        );

        return {
          success: true,
          data: result[0],
          message: "Role created successfully",
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 50 }),
          scope: t.String(),
          description: t.Optional(t.String()),
          permissions: t.Optional(t.Object({})),
        }),
      }
    )

    .put(
      "/:role_id",
      async (ctx) => {
        const role_id = Number.parseInt(ctx.params.role_id);
        const { description, permissions } = ctx.body as any;

        // Check if system role
        const role = await db.queryOne(
          "SELECT is_system_role FROM roles WHERE id = $1",
          [role_id]
        );

        if (role?.is_system_role) {
          return {
            success: false,
            error: "Cannot modify system roles",
          };
        }

        const result = await db.query(
          `UPDATE roles 
           SET description = $1, permissions = $2
           WHERE id = $3
           RETURNING *`,
          [
            description,
            JSON.stringify(permissions || {}),
            role_id,
          ]
        );

        return {
          success: true,
          data: result[0],
          message: "Role updated successfully",
        };
      },
      {
        body: t.Object({
          description: t.Optional(t.String()),
          permissions: t.Optional(t.Object({})),
        }),
      }
    )

    .delete("/:role_id", async (ctx) => {
      const role_id = Number.parseInt(ctx.params.role_id);

      // Check if system role
      const role = await db.queryOne(
        "SELECT is_system_role FROM roles WHERE id = $1",
        [role_id]
      );

      if (role?.is_system_role) {
        return {
          success: false,
          error: "Cannot delete system roles",
        };
      }

      // Check if role is in use
      const inUse = await db.query(
        `SELECT COUNT(*) as count FROM organization_members WHERE role_id = $1
         UNION ALL
         SELECT COUNT(*) as count FROM team_members WHERE role_id = $1`,
        [role_id]
      );

      const count = inUse.reduce((sum: number, row: any) => sum + row.count, 0);
      if (count > 0) {
        return {
          success: false,
          error: "Cannot delete role that is in use",
        };
      }

      await db.query("DELETE FROM roles WHERE id = $1", [role_id]);
      return { success: true, message: "Role deleted successfully" };
    })

    // ============================================================
    // Permission Helper Endpoints
    // ============================================================

    .get("/permissions/org", async () => {
      const permissions = {
        read: "Read organization data",
        write: "Edit organization configuration",
        delete: "Delete organization or critical data",
        admin: "Administrative access",
        manage_members: "Manage organization members",
        manage_teams: "Create and manage teams",
      };
      return { success: true, data: permissions };
    })

    .get("/permissions/team", async () => {
      const permissions = {
        read: "Read team data",
        write: "Edit team configuration",
        delete: "Delete team (if authorized)",
        admin: "Team administrative access",
        manage_members: "Manage team members",
        create_subteams: "Create team hierarchies",
        create_devices: "Create and manage devices",
        monitor_devices: "Monitor team devices",
      };
      return { success: true, data: permissions };
    });
}
