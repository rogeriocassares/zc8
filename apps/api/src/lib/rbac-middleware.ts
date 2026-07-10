/**
 * RBAC Middleware for Elysia API
 *
 * Provides role-based access control enforcement for organization and team endpoints
 */

import type { Elysia } from "elysia";
import type { Database } from "./adapter-types";

export interface AuthContext {
  userId: string;
  email: string;
  organizationId: bigint;
  organizationName: string;
  memberRole: string;
  teamId?: bigint;
  teamRole?: string;
}

export interface PermissionCheck {
  scope: "organization" | "team";
  requiredPermission: string;
  organizationId?: bigint;
  teamId?: bigint;
}

export class RBACMiddleware {
  constructor(private db: Database) { }

  /**
   * Extract user from JWT token and check permissions
   */
  async checkPermission(
    authContext: AuthContext,
    permissionCheck: PermissionCheck
  ): Promise<boolean> {
    try {
      if (permissionCheck.scope === "organization") {
        const org = await this.db.queryOne(
          `SELECT om.role_id, r.permissions 
           FROM organization_members om
           JOIN roles r ON om.role_id = r.id
           WHERE om.user_id = $1 AND om.organization_id = $2`,
          [authContext.userId, permissionCheck.organizationId]
        );

        if (!org) return false;

        const permissions = typeof org.permissions === "string"
          ? JSON.parse(org.permissions)
          : org.permissions || {};

        return permissions[permissionCheck.requiredPermission] === true;
      } else if (permissionCheck.scope === "team") {
        const team = await this.db.queryOne(
          `SELECT tm.role_id, r.permissions 
           FROM team_members tm
           JOIN roles r ON tm.role_id = r.id
           WHERE tm.user_id = $1 AND tm.team_id = $2`,
          [authContext.userId, permissionCheck.teamId]
        );

        if (!team) return false;

        const permissions = typeof team.permissions === "string"
          ? JSON.parse(team.permissions)
          : team.permissions || {};

        return permissions[permissionCheck.requiredPermission] === true;
      }

      return false;
    } catch (error) {
      console.error("RBAC check failed:", error);
      return false;
    }
  }

  /**
   * Get user's role in organization
   */
  async getUserOrgRole(
    userId: string,
    orgId: bigint
  ): Promise<string | null> {
    const result = await this.db.queryOne(
      `SELECT r.name FROM organization_members om
       JOIN roles r ON om.role_id = r.id
       WHERE om.user_id = $1 AND om.organization_id = $2`,
      [userId, orgId]
    );
    return (result?.name as string | undefined) || null;
  }

  /**
   * Get user's role in team
   */
  async getUserTeamRole(userId: string, teamId: bigint): Promise<string | null> {
    const result = await this.db.queryOne(
      `SELECT r.name FROM team_members tm
       JOIN roles r ON tm.role_id = r.id
       WHERE tm.user_id = $1 AND tm.team_id = $2`,
      [userId, teamId]
    );
    return (result?.name as string | undefined) || null;
  }

  /**
   * Get all organizations a user belongs to
   */
  async getUserOrganizations(userId: string) {
    return await this.db.query(
      `SELECT o.id, o.name, o.slug, o.org_type, r.name as role_name
       FROM organization_members om
       JOIN organizations o ON om.organization_id = o.id
       JOIN roles r ON om.role_id = r.id
       WHERE om.user_id = $1 AND om.invitation_status = 'accepted'
       ORDER BY o.name`,
      [userId]
    );
  }

  /**
   * Get all teams in an organization that user belongs to
   */
  async getUserTeamsInOrg(userId: string, orgId: bigint) {
    return await this.db.query(
      `SELECT t.id, t.name, t.slug, t.team_type, r.name as role_name
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       JOIN roles r ON tm.role_id = r.id
       WHERE tm.user_id = $1 AND t.organization_id = $2 AND tm.invitation_status = 'accepted'
       ORDER BY t.name`,
      [userId, orgId]
    );
  }

  /**
   * Check if user is org owner or admin
   */
  async isOrgAdmin(userId: string, orgId: bigint): Promise<boolean> {
    const result = await this.db.queryOne(
      `SELECT r.name FROM organization_members om
       JOIN roles r ON om.role_id = r.id
       WHERE om.user_id = $1 AND om.organization_id = $2 AND r.name IN ('Owner', 'Admin')`,
      [userId, orgId]
    );
    return !!result;
  }

  /**
   * Check if user is team owner or admin
   */
  async isTeamAdmin(userId: string, teamId: bigint): Promise<boolean> {
    const result = await this.db.queryOne(
      `SELECT r.name FROM team_members tm
       JOIN roles r ON tm.role_id = r.id
       WHERE tm.user_id = $1 AND tm.team_id = $2 AND r.name IN ('Owner', 'Admin')`,
      [userId, teamId]
    );
    return !!result;
  }

  /**
   * Check if user is org owner (highest privilege)
   */
  async isOrgOwner(userId: string, orgId: bigint): Promise<boolean> {
    const result = await this.db.queryOne(
      `SELECT r.name FROM organization_members om
       JOIN roles r ON om.role_id = r.id
       WHERE om.user_id = $1 AND om.organization_id = $2 AND r.name = 'Owner'`,
      [userId, orgId]
    );
    return !!result;
  }
}

/**
 * Helper to create permission-checked routes
 */
export function createRBACGuard(rbac: RBACMiddleware) {
  return {
    async requireOrgPermission(
      authContext: AuthContext,
      permission: string,
      orgId: bigint
    ) {
      const allowed = await rbac.checkPermission(authContext, {
        scope: "organization",
        requiredPermission: permission,
        organizationId: orgId,
      });

      if (!allowed) {
        throw new Error(`Insufficient permissions: ${permission} not allowed`);
      }
    },

    async requireTeamPermission(
      authContext: AuthContext,
      permission: string,
      teamId: bigint
    ) {
      const allowed = await rbac.checkPermission(authContext, {
        scope: "team",
        requiredPermission: permission,
        teamId,
      });

      if (!allowed) {
        throw new Error(`Insufficient permissions: ${permission} not allowed`);
      }
    },

    async requireOrgAdmin(authContext: AuthContext, orgId: bigint) {
      const isAdmin = await rbac.isOrgAdmin(authContext.userId, orgId);
      if (!isAdmin) {
        throw new Error("This action requires organization admin privileges");
      }
    },

    async requireOrgOwner(authContext: AuthContext, orgId: bigint) {
      const isOwner = await rbac.isOrgOwner(authContext.userId, orgId);
      if (!isOwner) {
        throw new Error("This action requires organization owner privileges");
      }
    },
  };
}
