# RBAC and Hierarchical Organizations Implementation Guide

## Overview

This document describes the implementation of Role-Based Access Control (RBAC) and hierarchical organization structure for the ZC8 platform.

## Changes Made

### 1. Database Schema Updates (Migration 001)

#### New Tables Added:

- **roles**: Define organization and team-scoped roles with permissions
  - Scopes: `organization` or `team`
  - Permissions stored as JSONB
  - System roles: Owner, Admin, Member (cannot be deleted)

- **organization_members**: Link users to organizations with RBAC
  - One-to-Many: Organization → Users
  - Tracks role, joined date, invitation status
  - Supports pending/accepted/declined invitations

- **team_members**: Link users to teams with RBAC
  - One-to-Many: Team → Users
  - Tracks role, joined date, invitation status
  - Supports pending/accepted/declined invitations

#### Schema Modifications:

- **organizations table**:
  - Added `parent_id` (BIGINT, FOREIGN KEY): For hierarchical parent-child relationships
  - Added `org_type` (VARCHAR): Distinguishes between 'parent', 'child', 'standard' organizations
  - Unique constraint on (parent_id, slug) for scoped slugs

- **users table**:
  - Added `phone` (VARCHAR)
  - Added `avatar_url` (VARCHAR)
  - Added `email_verified` (BOOLEAN)

- **teams table**:
  - Added `parent_team_id` (BIGINT, FOREIGN KEY): For nested subteams
  - team_type now supports: 'department', 'project', 'special', 'subteam'
  - Unique constraint on (organization_id, parent_team_id, slug)

#### Removed/Deprecated:

- `device_registry_deprecated` table - Entirely unused, can be safely removed
- `organization_access_permissions` table - Replaced by organization_members RBAC
- `team_access_permissions` table - Replaced by team_members RBAC

#### Indexes Added:

- All member and role lookups optimized with indexes on:
  - `idx_organization_members_*` (org, user, role, status)
  - `idx_team_members_*` (team, user, role, status)
  - `idx_organizations_parent` (for hierarchy queries)
  - `idx_teams_parent` (for subteam queries)

### 2. Seed Data Updates (Migration 002)

#### Organizations Created:

1. **Admin** (parent, org_type='parent')
   - Super organization managing all child organizations
   - Owner: Platform Admin

2. **IMT** (child of Admin)
   - Instituto Mauá de Tecnologia - Racing Organization
   - Owner: IMT Owner user

3. **FSAELive** (child of Admin)
   - Formula SAE Live - Event and Track Management
   - Owner: FSAELive Owner user

4. **StorioCloud** (child of Admin)
   - StorioCloud - Cloud Infrastructure and Analytics
   - Owner: StorioCloud Owner user

#### Teams Created:

**IMT Organization:**

- GMS (General Maintenance & Support)
- MauaRacing (Racing project team)

**FSAELive Organization:**

- Teams (Teams Management)
- RaceTracks (Race Tracks Operations)
- Committee (Event Committee)

**StorioCloud Organization:**

- Cinemark (Cinemark Integration project)
- UCI (UCI Integration project)

#### Roles Defined (6 System Roles):

**Organization-scoped:**

- Owner: Full control, can delete organization, manage billing
- Admin: Edit configuration, manage members and teams
- Member: Read-only access

**Team-scoped:**

- Owner: Create/delete team, manage members, create subteams
- Admin: Create/delete devices, manage members
- Member: Monitor devices only

#### Users Created:

- Platform Admin (admin@platform.com) → Admin org Owner
- IMT Owner (imt@imt.com) → IMT org Owner
- GMS Admin (gms@imt.com) → IMT org Admin
- MauaRacing Lead (maua@imt.com) → IMT org Admin
- FSAELive Owner (fsaelive@fsaelive.com) → FSAELive org Owner
- Committees Lead (committees@fsaelive.com) → FSAELive org Admin
- StorioCloud Owner (storiocloud@storiocloud.com) → StorioCloud org Owner
- Cinemark Manager (cinemark@storiocloud.com) → StorioCloud org Admin

### 3. API Routes Added

#### New Route Files:

1. **routes/organizations.ts**
   - GET /api/v1/organizations - List all organizations
   - GET /api/v1/organizations/:org_id - Get organization details
   - POST /api/v1/organizations - Create new organization
   - PUT /api/v1/organizations/:org_id - Update organization
   - DELETE /api/v1/organizations/:org_id - Delete organization
   - GET /api/v1/organizations/:org_id/members - List members
   - POST /api/v1/organizations/:org_id/members - Add member
   - PUT /api/v1/organizations/:org_id/members/:member_id - Update member role
   - DELETE /api/v1/organizations/:org_id/members/:member_id - Remove member
   - GET /api/v1/organizations/:org_id/children - List child organizations
   - GET /api/v1/organizations/:org_id/parent - Get parent organization

2. **routes/teams.ts**
   - GET /api/v1/orgs/:org_id/teams - List teams
   - GET /api/v1/orgs/:org_id/teams/:team_id - Get team details
   - POST /api/v1/orgs/:org_id/teams - Create team
   - PUT /api/v1/orgs/:org_id/teams/:team_id - Update team
   - DELETE /api/v1/orgs/:org_id/teams/:team_id - Delete team
   - GET /api/v1/orgs/:org_id/teams/:team_id/members - List members
   - POST /api/v1/orgs/:org_id/teams/:team_id/members - Add member
   - PUT /api/v1/orgs/:org_id/teams/:team_id/members/:member_id - Update member role
   - DELETE /api/v1/orgs/:org_id/teams/:team_id/members/:member_id - Remove member
   - GET /api/v1/orgs/:org_id/teams/:team_id/subteams - List subteams
   - GET /api/v1/orgs/:org_id/teams/:team_id/parent - Get parent team

3. **routes/roles.ts**
   - GET /api/v1/roles - List all roles (filterable by scope)
   - GET /api/v1/roles/:role_id - Get role details
   - GET /api/v1/roles/scope/:scope - List roles for scope
   - POST /api/v1/roles - Create custom role
   - PUT /api/v1/roles/:role_id - Update custom role
   - DELETE /api/v1/roles/:role_id - Delete custom role
   - GET /api/v1/roles/permissions/org - List org permissions
   - GET /api/v1/roles/permissions/team - List team permissions

#### RBAC Middleware:

**lib/rbac-middleware.ts**

- RBACMiddleware class for permission enforcement
- Methods:
  - checkPermission() - Verify specific permission
  - getUserOrgRole() - Get user's role in org
  - getUserTeamRole() - Get user's role in team
  - getUserOrganizations() - Get user's accessible orgs
  - getUserTeamsInOrg() - Get user's teams in org
  - isOrgAdmin() - Check admin status
  - isOrgOwner() - Check owner status
  - isTeamAdmin() - Check team admin status
- createRBACGuard() - Helper for route protection

## Permission Model

### Organization Permissions:

```json
{
  "read": true, // Can read org data
  "write": true, // Can edit org configuration
  "delete": true, // Can delete org
  "admin": true, // Administrative access
  "manage_members": true, // Can manage org members
  "manage_teams": true // Can create/manage teams
}
```

### Team Permissions:

```json
{
  "read": true, // Can read team data
  "write": true, // Can edit team config
  "delete": true, // Can delete team
  "admin": true, // Team admin access
  "manage_members": true, // Can manage team members
  "create_subteams": true, // Can create nested teams
  "create_devices": true, // Can create devices
  "monitor_devices": true // Can monitor team devices
}
```

## Hierarchical Organization Model

### Structure:

```
Admin (Parent)
├── IMT (Child)
├── FSAELive (Child)
└── StorioCloud (Child)
```

### Access Rules:

- **Parent org admins** can:
  - View all child organizations
  - Enforce policies across children
  - Manage child org creation/deletion
  - Access consolidated reports

- **Child org admins** can:
  - Manage only their own organization
  - Create and manage their own teams
  - Access their own devices and data

- **Data isolation** is enforced at:
  - Query level (organization_id filtering)
  - Middleware level (permission checks)
  - Table constraints (foreign keys)

## Nested Teams Structure

Each team can have:

- **Subteams** (parent_team_id): Create hierarchical team structures
- **Types**: department, project, special, subteam
- **Members with roles**: Owner, Admin, Member

Example:

```
MauaRacing Team
├── Technical Subteam
│   ├── Electronics
│   └── Mechanics
└── Operations Subteam
```

## Integration Steps

### 1. Update index.ts (apps/api/src/index.ts)

Add imports at the top:

```typescript
import { createOrganizationRoutes } from "./routes/organizations.ts";
import { createTeamRoutes } from "./routes/teams.ts";
import { createRoleRoutes } from "./routes/roles.ts";
import { RBACMiddleware, createRBACGuard } from "./lib/rbac-middleware.ts";
```

Initialize RBAC middleware (after pgPool setup):

```typescript
const rbac = new RBACMiddleware({
  query: (sql, params) => pgPool.query(sql, params),
  queryOne: (sql, params) => pgPool.query(sql, params).then((r) => r.rows[0]),
} as Database);
```

Add routes before `.listen()`:

```typescript
// Add before app.listen()
const orgRoutes = createOrganizationRoutes({
  query: (sql, params) => pgPool.query(sql, params).then((r) => r.rows),
  queryOne: (sql, params) => pgPool.query(sql, params).then((r) => r.rows[0]),
});

const teamRoutes = createTeamRoutes({
  query: (sql, params) => pgPool.query(sql, params).then((r) => r.rows),
  queryOne: (sql, params) => pgPool.query(sql, params).then((r) => r.rows[0]),
});

const roleRoutes = createRoleRoutes({
  query: (sql, params) => pgPool.query(sql, params).then((r) => r.rows),
  queryOne: (sql, params) => pgPool.query(sql, params).then((r) => r.rows[0]),
});

app.use(orgRoutes).use(teamRoutes).use(roleRoutes);
```

### 2. Deploy Migrations

```bash
# Drop existing database (if in development)
cd docker && docker compose down -v

# Start fresh PostgreSQL
docker compose up -d postgres

# Apply migrations
cd infra/postgres/migrations
psql -h localhost -U zc8 -d zc8 < 001_create_schema.sql
psql -h localhost -U zc8 -d zc8 < 002_seed_data.sql

# Verify
psql -h localhost -U zc8 -d zc8 -c "SELECT COUNT(*) as org_count FROM organizations;"
psql -h localhost -U zc8 -d zc8 -c "SELECT COUNT(*) as user_count FROM users;"
```

### 3. Test API Endpoints

```bash
# Get all organizations
curl http://localhost:3333/api/v1/organizations

# Get IMT organization
curl http://localhost:3333/api/v1/organizations/2

# List IMT members
curl http://localhost:3333/api/v1/organizations/2/members

# List IMT teams
curl http://localhost:3333/api/v1/orgs/2/teams

# List all roles
curl http://localhost:3333/api/v1/roles?scope=organization

# Get organization permissions
curl http://localhost:3333/api/v1/roles/permissions/org
```

## Authorization Checks to Implement

The following checks should be added to protected endpoints:

```typescript
// Example: Update organization
async ({ params, body, headers }) => {
  const org_id = parseInt(params.org_id);
  const authContext = userJwtHandler.extractFromHeader(headers.authorization);

  // Check permission
  try {
    await rbacGuard.requireOrgPermission(authContext, 'write', BigInt(org_id));
  } catch {
    return { error: "Insufficient permissions", status: 403 };
  }

  // Proceed with update
  ...
}
```

## Testing Scenario

1. **Login as IMT Owner**: Should have full access to IMT organization
2. **Switch to MauaRacing Team**: Should see team-level permissions
3. **Try to access FSAELive**: Should get permission denied
4. **Admin user**: Should access everything

## Backward Compatibility

- Existing device routes remain unchanged
- Organization_id is still used for data isolation
- No breaking changes to device API
- User can be in multiple organizations with different roles

## Security Notes

1. **Principle of Least Privilege**: Users only get minimum required permissions
2. **Scope Separation**: Org permissions don't affect team permissions
3. **Invitation Flow**: Members can be invited and must accept
4. **Audit Trail**: All member changes tracked with timestamps and inviter info
5. **System Roles Protected**: Cannot delete or modify built-in roles

## Future Enhancements

1. **Permission Inheritance**: Teams inherit some org policies
2. **Delegation**: Allow admins to delegate specific permissions
3. **Audit Logs**: Track all permission-related actions
4. **Team Invitations**: Email-based team invitations
5. **SSO Integration**: Connect RBAC with external identity providers
6. **Fine-Grained Permissions**: More granular device/resource permissions
