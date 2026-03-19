/**
 * Teams Management API Routes
 *
 * Endpoints for managing:
 * - Teams (hierarchical within organizations)
 * - Team members with RBAC
 * - Team hierarchy and nested teams
 */

import { Elysia, t } from "elysia";
import type { Database } from "../lib/adapter-types";

interface TeamCreateRequest {
  name: string;
  slug: string;
  description?: string;
  team_type?: "department" | "project" | "special" | "subteam";
  parent_team_id?: number;
}

interface TeamMemberRequest {
  user_id: string;
  role_id: number;
}

export function createTeamRoutes(db: Database) {
  return new Elysia({ prefix: "/api/v1/orgs/:org_id/teams" })
    // ============================================================
    // Team CRUD Endpoints
    // ============================================================

    .get("/", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const teams = await db.query(
        `SELECT id, name, slug, description, team_type, status, parent_team_id, created_at
         FROM teams 
         WHERE organization_id = $1 
         ORDER BY parent_team_id NULLS FIRST, name`,
        [org_id]
      );
      return {
        success: true,
        data: teams,
        total: teams.length,
      };
    })

    .get("/:team_id", async (ctx) => {
      const { org_id, team_id } = ctx.params;
      const team = await db.queryOne(
        `SELECT * FROM teams 
         WHERE id = $1 AND organization_id = $2`,
        [team_id, org_id]
      );
      if (!team) {
        return { success: false, error: "Team not found" };
      }
      return { success: true, data: team };
    })

    .post(
      "/",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const { name, slug, description, team_type, parent_team_id } =
          ctx.body as TeamCreateRequest;

        // Verify parent team if specified
        if (parent_team_id) {
          const parentTeam = await db.queryOne(
            "SELECT id FROM teams WHERE id = $1 AND organization_id = $2",
            [parent_team_id, org_id]
          );
          if (!parentTeam) {
            return { success: false, error: "Parent team not found" };
          }
        }

        const result = await db.query(
          `INSERT INTO teams (organization_id, name, slug, description, team_type, parent_team_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')
           RETURNING *`,
          [
            org_id,
            name,
            slug,
            description || null,
            team_type || "department",
            parent_team_id || null,
          ]
        );

        return {
          success: true,
          data: result[0],
          message: "Team created successfully",
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 255 }),
          slug: t.String({ minLength: 1, maxLength: 255 }),
          description: t.Optional(t.String()),
          team_type: t.Optional(
            t.Enum({ department: "department", project: "project", special: "special", subteam: "subteam" })
          ),
          parent_team_id: t.Optional(t.Number()),
        }),
      }
    )

    .put(
      "/:team_id",
      async (ctx) => {
        const { org_id, team_id } = ctx.params;
        const { name, description, status } = ctx.body as any;

        const result = await db.query(
          `UPDATE teams 
           SET name = $1, description = $2, status = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND organization_id = $5
           RETURNING *`,
          [name, description, status, team_id, org_id]
        );

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
        }),
      }
    )

    .delete("/:team_id", async (ctx) => {
      const { org_id, team_id } = ctx.params;

      // Check if team has subteams
      const subteams = await db.query(
        "SELECT COUNT(*) as count FROM teams WHERE parent_team_id = $1",
        [team_id]
      );

      if (subteams[0].count > 0) {
        return {
          success: false,
          error: "Cannot delete team with subteams",
        };
      }

      await db.query(
        "DELETE FROM teams WHERE id = $1 AND organization_id = $2",
        [team_id, org_id]
      );
      return { success: true, message: "Team deleted successfully" };
    })

    // ============================================================
    // Team Members Endpoints
    // ============================================================

    .get("/:team_id/members", async (ctx) => {
      const { org_id, team_id } = ctx.params;
      const members = await db.query(
        `SELECT tm.id, tm.user_id, tm.role_id, u.email, u.first_name, u.last_name,
                r.name as role_name, tm.joined_at, tm.invitation_status
         FROM team_members tm
         JOIN users u ON tm.user_id = u.id
         JOIN roles r ON tm.role_id = r.id
         WHERE tm.team_id = $1 
         ORDER BY tm.joined_at DESC`,
        [team_id]
      );
      return { success: true, data: members, total: members.length };
    })

    .post(
      "/:team_id/members",
      async (ctx) => {
        const { team_id } = ctx.params;
        const { user_id, role_id } = ctx.body as TeamMemberRequest;

        // Verify role is team-scoped
        const role = await db.queryOne(
          "SELECT * FROM roles WHERE id = $1 AND scope = 'team'",
          [role_id]
        );
        if (!role) {
          return {
            success: false,
            error: "Invalid team-scoped role",
          };
        }

        const result = await db.query(
          `INSERT INTO team_members (team_id, user_id, role_id, joined_at, invitation_status)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'accepted')
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [team_id, user_id, role_id]
        );

        if (result.length === 0) {
          return {
            success: false,
            error: "Member already exists in team",
          };
        }

        return {
          success: true,
          data: result[0],
          message: "Member added to team successfully",
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
      "/:team_id/members/:member_id",
      async (ctx) => {
        const { team_id, member_id } = ctx.params;
        const { role_id } = ctx.body as any;

        const result = await db.query(
          `UPDATE team_members 
           SET role_id = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND team_id = $3
           RETURNING *`,
          [role_id, member_id, team_id]
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

    .delete("/:team_id/members/:member_id", async (ctx) => {
      const { team_id, member_id } = ctx.params;
      await db.query(
        "DELETE FROM team_members WHERE id = $1 AND team_id = $2",
        [member_id, team_id]
      );
      return { success: true, message: "Member removed from team" };
    })

    // ============================================================
    // Team Hierarchy Endpoints
    // ============================================================

    .get("/:team_id/subteams", async (ctx) => {
      const { team_id } = ctx.params;
      const subteams = await db.query(
        `SELECT id, name, slug, team_type, status 
         FROM teams 
         WHERE parent_team_id = $1
         ORDER BY name`,
        [team_id]
      );
      return { success: true, data: subteams, total: subteams.length };
    })

    .get("/:team_id/parent", async (ctx) => {
      const { team_id } = ctx.params;
      const team = await db.queryOne(
        "SELECT parent_team_id FROM teams WHERE id = $1",
        [team_id]
      );
      if (!team?.parent_team_id) {
        return { success: false, error: "Team has no parent" };
      }
      const parent = await db.queryOne(
        "SELECT id, name, slug, team_type FROM teams WHERE id = $1",
        [team.parent_team_id]
      );
      return { success: true, data: parent };
    });
}
