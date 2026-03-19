/**
 * Organizations Management API Routes
 *
 * Endpoints for managing:
 * - Organizations (hierarchical parent-child structure)
 * - Organization members with RBAC
 * - Organization hierarchy and access control
 */

import { Elysia, t } from "elysia";
import type { Database } from "../lib/adapter-types";

interface OrganizationCreateRequest {
  name: string;
  slug: string;
  description?: string;
  parent_id?: number;
}

interface OrganizationMemberRequest {
  user_id: string;
  role_id: number;
}

export function createOrganizationRoutes(db: Database) {
  return new Elysia({ prefix: "/api/v1/organizations" })
    // ============================================================
    // Organization CRUD Endpoints
    // ============================================================

    .get("/", async () => {
      const organizations = await db.query(
        "SELECT id, name, slug, description, org_type, status, parent_id FROM organizations ORDER BY id"
      );
      return {
        success: true,
        data: organizations,
        total: organizations.length,
      };
    })

    .get("/:org_id", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const org = await db.queryOne(
        "SELECT * FROM organizations WHERE id = $1",
        [org_id]
      );
      if (!org) {
        return { success: false, error: "Organization not found" };
      }
      return { success: true, data: org };
    })

    .post(
      "/",
      async (ctx) => {
        const { name, slug, description, parent_id } = ctx.body as OrganizationCreateRequest;
        const result = await db.query(
          `INSERT INTO organizations (name, slug, description, parent_id, org_type, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           RETURNING *`,
          [name, slug, description || null, parent_id || null, parent_id ? "child" : "standard"]
        );
        return {
          success: true,
          data: result[0],
          message: "Organization created successfully",
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 255 }),
          slug: t.String({ minLength: 1, maxLength: 255 }),
          description: t.Optional(t.String()),
          parent_id: t.Optional(t.Number()),
        }),
      }
    )

    .put(
      "/:org_id",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const { name, description, status } = ctx.body as any;
        const result = await db.query(
          `UPDATE organizations 
           SET name = $1, description = $2, status = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING *`,
          [name, description, status, org_id]
        );
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
        }),
      }
    )

    .delete("/:org_id", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);

      // Check if org is parent of other orgs
      const children = await db.query(
        "SELECT COUNT(*) as count FROM organizations WHERE parent_id = $1",
        [org_id]
      );

      if (children[0].count > 0) {
        return {
          success: false,
          error: "Cannot delete organization with child organizations",
        };
      }

      await db.query("DELETE FROM organizations WHERE id = $1", [org_id]);
      return { success: true, message: "Organization deleted successfully" };
    })

    // ============================================================
    // Organization Members Endpoints
    // ============================================================

    .get("/:org_id/members", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const members = await db.query(
        `SELECT om.id, om.user_id, om.role_id, u.email, u.first_name, u.last_name, 
                r.name as role_name, om.joined_at, om.invitation_status
         FROM organization_members om
         JOIN users u ON om.user_id = u.id
         JOIN roles r ON om.role_id = r.id
         WHERE om.organization_id = $1
         ORDER BY om.joined_at DESC`,
        [org_id]
      );
      return { success: true, data: members, total: members.length };
    })

    .post(
      "/:org_id/members",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const { user_id, role_id } = ctx.body as OrganizationMemberRequest;

        // Verify role is organization-scoped
        const role = await db.queryOne(
          "SELECT * FROM roles WHERE id = $1 AND scope = 'organization'",
          [role_id]
        );
        if (!role) {
          return {
            success: false,
            error: "Invalid organization-scoped role",
          };
        }

        const result = await db.query(
          `INSERT INTO organization_members (organization_id, user_id, role_id, joined_at, invitation_status)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'accepted')
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [org_id, user_id, role_id]
        );

        if (result.length === 0) {
          return {
            success: false,
            error: "Member already exists in organization",
          };
        }

        return {
          success: true,
          data: result[0],
          message: "Member added to organization successfully",
        };
      },
      {
        body: t.Object({
          user_id: t.String(),
          role_id: t.Number(),
        }),
      }
    )

    .put(
      "/:org_id/members/:member_id",
      async (ctx) => {
        const { org_id, member_id } = ctx.params;
        const { role_id } = ctx.body as any;

        const result = await db.query(
          `UPDATE organization_members 
           SET role_id = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND organization_id = $3
           RETURNING *`,
          [role_id, member_id, org_id]
        );

        return {
          success: true,
          data: result[0],
          message: "Member role updated successfully",
        };
      },
      {
        body: t.Object({
          role_id: t.Number(),
        }),
      }
    )

    .delete("/:org_id/members/:member_id", async (ctx) => {
      const { org_id, member_id } = ctx.params;
      await db.query(
        "DELETE FROM organization_members WHERE id = $1 AND organization_id = $2",
        [member_id, org_id]
      );
      return { success: true, message: "Member removed from organization" };
    })

    // ============================================================
    // Organization Hierarchy Endpoints
    // ============================================================

    .get("/:org_id/children", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const children = await db.query(
        "SELECT id, name, slug, org_type, status FROM organizations WHERE parent_id = $1",
        [org_id]
      );
      return { success: true, data: children, total: children.length };
    })

    .get("/:org_id/parent", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const org = await db.queryOne(
        "SELECT parent_id FROM organizations WHERE id = $1",
        [org_id]
      );
      if (!org?.parent_id) {
        return { success: false, error: "Organization has no parent" };
      }
      const parent = await db.queryOne(
        "SELECT id, name, slug, org_type FROM organizations WHERE id = $1",
        [org.parent_id]
      );
      return { success: true, data: parent };
    });
}
