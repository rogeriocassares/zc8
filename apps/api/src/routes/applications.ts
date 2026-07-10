/**
 * Applications Management API Routes
 * Applications are team-scoped resources (replaced subteams)
 */

import { and, count, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import {
  type AuthContext,
  getOrgMemberRole,
  getTeamMemberRole,
  requireAuth,
} from "../db/auth";
import {
  applicationDevices,
  applicationSensorTypes,
  applicationSensorValues,
  applications,
  deviceModels,
  deviceRegistry,
  deviceSensors,
  deviceVendors,
  organizations,
  teams,
  users,
} from "../db/schema";
import { getPlanConfig } from "./plan-config";

// ── Global listing: GET /api/v1/applications ──────────────────────────────────
export function createGlobalApplicationRoutes(db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/applications" })
    .use(requireAuth())
    .get("/", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const { org_id } = ctx.query as { org_id?: string };

      const conditions: ReturnType<typeof eq>[] = [];

      if (auth.role !== "superAdmin") {
        const effectiveOrgId = org_id ? Number(org_id) : auth.orgId;
        if (!effectiveOrgId) return { success: true, data: [], total: 0 };
        const orgRole = await getOrgMemberRole(db, auth.userId, effectiveOrgId);
        if (!orgRole) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Not a member of this organization" };
        }
        conditions.push(eq(organizations.id, effectiveOrgId));
      } else if (org_id) {
        conditions.push(eq(organizations.id, Number(org_id)));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          id: applications.id,
          teamId: applications.teamId,
          teamName: teams.name,
          organizationId: organizations.id,
          organizationName: organizations.name,
          name: applications.name,
          slug: applications.slug,
          description: applications.description,
          status: applications.status,
          visibility: applications.visibility,
          redisCacheSize: applications.redisCacheSize,
          createdBy: applications.createdBy,
          createdAt: applications.createdAt,
          updatedAt: applications.updatedAt,
        })
        .from(applications)
        .innerJoin(teams, eq(applications.teamId, teams.id))
        .innerJoin(organizations, eq(teams.organizationId, organizations.id))
        .where(where)
        .orderBy(organizations.name, teams.name, applications.name);

      // Load sensor subscriptions per app
      const appIds = rows.map((r) => r.id);
      const sensorMap = new Map<number, string[]>();
      if (appIds.length > 0) {
        const sensorRows = await db
          .select({
            applicationId: applicationSensorTypes.applicationId,
            sensorType: applicationSensorTypes.sensorType,
          })
          .from(applicationSensorTypes)
          .where(
            sql`${applicationSensorTypes.applicationId} = ANY(${sql.raw(`ARRAY[${appIds.join(",")}]::int[]`)})`,
          )
          .orderBy(
            applicationSensorTypes.applicationId,
            applicationSensorTypes.sensorType,
          );
        for (const sr of sensorRows) {
          if (!sensorMap.has(sr.applicationId))
            sensorMap.set(sr.applicationId, []);
          const entry = sensorMap.get(sr.applicationId);
          if (entry) entry.push(sr.sensorType);
        }
      }

      // Load device connection counts per application
      const deviceCountMap = new Map<
        number,
        { total: number; connected: number }
      >();
      if (appIds.length > 0) {
        const countRows = await db
          .select({
            applicationId: applicationDevices.applicationId,
            total: sql<number>`COUNT(${applicationDevices.deviceId})::int`,
            connected: sql<number>`COUNT(CASE WHEN ${deviceRegistry.connectionStatus} = 'connected' THEN 1 END)::int`,
          })
          .from(applicationDevices)
          .leftJoin(
            deviceRegistry,
            eq(deviceRegistry.id, applicationDevices.deviceId),
          )
          .where(
            sql`${applicationDevices.applicationId} = ANY(${sql.raw(`ARRAY[${appIds.join(",")}]::int[]`)})`,
          )
          .groupBy(applicationDevices.applicationId);
        for (const cr of countRows) {
          deviceCountMap.set(cr.applicationId, {
            total: cr.total,
            connected: cr.connected,
          });
        }
      }

      const data = rows.map((r) => {
        const counts = deviceCountMap.get(r.id);
        return {
          id: r.id,
          team_id: r.teamId,
          team_name: r.teamName,
          organization_id: r.organizationId,
          organization_name: r.organizationName,
          name: r.name,
          slug: r.slug,
          description: r.description,
          status: r.status,
          visibility: r.visibility,
          redis_cache_size: r.redisCacheSize,
          created_by: r.createdBy,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
          sensor_types: sensorMap.get(r.id) ?? [],
          total_device_count: counts?.total ?? 0,
          connected_device_count: counts?.connected ?? 0,
        };
      });

      return { success: true, data, total: data.length };
    });
}

export function createApplicationRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1/orgs/:org_id/teams/:team_id/applications" })
      .use(requireAuth())

      // ----------------------------------------------------------------
      // List applications for a team
      // ----------------------------------------------------------------
      .get("/", async (ctx) => {
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
          if (!teamRole && !orgRole) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Team or org membership required" };
          }
        }

        const apps = await db
          .select({
            id: applications.id,
            teamId: applications.teamId,
            name: applications.name,
            slug: applications.slug,
            description: applications.description,
            status: applications.status,
            createdBy: applications.createdBy,
            createdAt: applications.createdAt,
            updatedAt: applications.updatedAt,
          })
          .from(applications)
          .where(eq(applications.teamId, Number(team_id)))
          .orderBy(applications.name);

        const data = apps.map((a) => ({
          id: a.id,
          team_id: a.teamId,
          name: a.name,
          slug: a.slug,
          description: a.description,
          status: a.status,
          created_by: a.createdBy,
          created_at: a.createdAt,
          updated_at: a.updatedAt,
        }));
        return { success: true, data, total: data.length };
      })

      // ----------------------------------------------------------------
      // Get single application
      // ----------------------------------------------------------------
      .get("/:app_id", async (ctx) => {
        const { org_id, team_id, app_id } = ctx.params;
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
          if (!teamRole && !orgRole) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Team or org membership required" };
          }
        }

        const [app] = await db
          .select()
          .from(applications)
          .where(
            and(
              eq(applications.id, Number(app_id)),
              eq(applications.teamId, Number(team_id)),
            ),
          )
          .limit(1);

        if (!app) {
          (ctx as unknown as { set: { status: number } }).set.status = 404;
          return { success: false, error: "Application not found" };
        }
        return { success: true, data: app };
      })

      // ----------------------------------------------------------------
      // Create application (team owner/admin only; plan limit enforced)
      // ----------------------------------------------------------------
      .post(
        "/",
        async (ctx) => {
          const { org_id, team_id } = ctx.params;
          const { name, slug, description, visibility } = ctx.body as {
            name: string;
            slug: string;
            description?: string;
            visibility?: string;
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
            const canCreate =
              teamRole === "teamowner" ||
              teamRole === "teamadmin" ||
              orgRole === "owner" ||
              orgRole === "admin";
            if (!canCreate) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error:
                  "TeamOwner, TeamAdmin, OrgOwner or OrgAdmin access required to create an application",
              };
            }
          }

          // Enforce plan limit for maxAppsPerTeam
          const team = await db.query.teams.findFirst({
            where: eq(teams.id, Number(team_id)),
            columns: { organizationId: true },
          });
          if (!team) {
            (ctx as unknown as { set: { status: number } }).set.status = 404;
            return { success: false, error: "Team not found" };
          }

          const org = await db.query.organizations.findFirst({
            where: (orgs) => eq(orgs.id, team.organizationId ?? 0),
            columns: { ownerId: true },
          });
          const planOwnerId = org?.ownerId ?? auth.userId;
          const orgOwner = await db.query.users.findFirst({
            where: eq(users.id, planOwnerId as string),
            columns: { plan: true },
          });
          const ownerPlan = orgOwner?.plan ?? "hobby";
          const planCfg = await getPlanConfig(db, ownerPlan);

          if (planCfg.maxAppsPerTeam === 0) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error: "Your plan does not allow creating applications",
            };
          }
          if (planCfg.maxAppsPerTeam > 0) {
            const [{ value: appCount }] = await db
              .select({ value: count() })
              .from(applications)
              .where(eq(applications.teamId, Number(team_id)));
            if (appCount >= planCfg.maxAppsPerTeam) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: `Application limit reached (${appCount}/${planCfg.maxAppsPerTeam})`,
              };
            }
          }

          const [created] = await db
            .insert(applications)
            .values({
              teamId: Number(team_id),
              name,
              slug,
              description: description || null,
              status: "active",
              visibility: (visibility as "team" | "org" | "public") ?? "team",
              redisCacheSize: (ctx.body as { redis_cache_size?: number }).redis_cache_size ?? 1,
              createdBy: auth.userId,
            })
            .returning();
          return {
            success: true,
            data: created,
            message: "Application created successfully",
          };
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1, maxLength: 255 }),
            slug: t.String({ minLength: 1, maxLength: 255 }),
            description: t.Optional(t.String()),
            visibility: t.Optional(t.Union([t.Literal("team"), t.Literal("org"), t.Literal("public")])),
            redis_cache_size: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
          }),
        },
      )

      // ----------------------------------------------------------------
      // Update application (team owner/admin only)
      // ----------------------------------------------------------------
      .put(
        "/:app_id",
        async (ctx) => {
          const { org_id, team_id, app_id } = ctx.params;
          const { name, description, status, visibility } = ctx.body as {
            name?: string;
            description?: string;
            status?: string;
            visibility?: string;
            redis_cache_size?: number;
          };
          const redisCacheSize = (ctx.body as { redis_cache_size?: number }).redis_cache_size;
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
              orgRole === "owner" ||
              orgRole === "admin";
            if (!canEdit) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error: "TeamOwner, TeamAdmin, OrgOwner or OrgAdmin access required",
              };
            }
          }

          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (name !== undefined) updates.name = name;
          if (description !== undefined) updates.description = description;
          if (status !== undefined) updates.status = status;
          if (visibility !== undefined) updates.visibility = visibility;
          if (redisCacheSize !== undefined) updates.redisCacheSize = redisCacheSize;

          const result = await db
            .update(applications)
            .set(updates)
            .where(
              and(
                eq(applications.id, Number(app_id)),
                eq(applications.teamId, Number(team_id)),
              ),
            )
            .returning();

          if (!result[0]) {
            (ctx as unknown as { set: { status: number } }).set.status = 404;
            return { success: false, error: "Application not found" };
          }
          return {
            success: true,
            data: result[0],
            message: "Application updated successfully",
          };
        },
        {
          body: t.Object({
            name: t.Optional(t.String()),
            description: t.Optional(t.String()),
            status: t.Optional(t.String()),
            visibility: t.Optional(t.Union([t.Literal("team"), t.Literal("org"), t.Literal("public")])),
            redis_cache_size: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
          }),
        },
      )

      // ----------------------------------------------------------------
      // Delete application (team owner/admin only)
      // ----------------------------------------------------------------
      .delete("/:app_id", async (ctx) => {
        const { org_id, team_id, app_id } = ctx.params;
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
              error:
                "TeamOwner or OrgOwner access required to delete application",
            };
          }
        }

        await db
          .delete(applications)
          .where(
            and(
              eq(applications.id, Number(app_id)),
              eq(applications.teamId, Number(team_id)),
            ),
          );
        return { success: true, message: "Application deleted successfully" };
      })

      // ----------------------------------------------------------------
      // List devices assigned to an application
      // ----------------------------------------------------------------
      .get("/:app_id/devices", async (ctx) => {
        const { org_id, team_id, app_id } = ctx.params;
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
          if (!teamRole && !orgRole) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Team or org membership required" };
          }
        }

        const rows = await db
          .select({
            assignmentId: applicationDevices.id,
            deviceId: applicationDevices.deviceId,
            assignedAt: applicationDevices.assignedAt,
            assignedBy: applicationDevices.assignedBy,
            deviceKey: deviceRegistry.deviceKey,
            deviceType: deviceRegistry.deviceType,
            connectionStatus: deviceRegistry.connectionStatus,
          })
          .from(applicationDevices)
          .innerJoin(
            deviceRegistry,
            eq(applicationDevices.deviceId, deviceRegistry.id),
          )
          .where(eq(applicationDevices.applicationId, Number(app_id)))
          .orderBy(applicationDevices.assignedAt);

        const data = rows.map((r) => ({
          assignment_id: r.assignmentId,
          device_id: r.deviceId,
          assigned_at: r.assignedAt,
          assigned_by: r.assignedBy,
          device_key: r.deviceKey,
          device_type: r.deviceType,
          connection_status: r.connectionStatus,
        }));
        return { success: true, data, total: data.length };
      })

      // ----------------------------------------------------------------
      // Assign a device to an application (team owner/admin only)
      // ----------------------------------------------------------------
      .post(
        "/:app_id/devices",
        async (ctx) => {
          const { org_id, team_id, app_id } = ctx.params;
          const { device_id } = ctx.body as { device_id: string };
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
            const canAssign =
              teamRole === "teamowner" ||
              teamRole === "teamadmin" ||
              orgRole === "owner";
            if (!canAssign) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return {
                success: false,
                error:
                  "TeamOwner, TeamAdmin or OrgOwner access required to assign devices",
              };
            }
          }

          // Verify device belongs to the same team
          const [device] = await db
            .select({ id: deviceRegistry.id, teamId: deviceRegistry.teamId })
            .from(deviceRegistry)
            .where(eq(deviceRegistry.id, device_id))
            .limit(1);

          if (!device) {
            (ctx as unknown as { set: { status: number } }).set.status = 404;
            return { success: false, error: "Device not found" };
          }
          if (device.teamId !== Number(team_id)) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error: "Device does not belong to this team",
            };
          }

          const [created] = await db
            .insert(applicationDevices)
            .values({
              applicationId: Number(app_id),
              deviceId: device_id,
              assignedBy: auth.userId,
            })
            .onConflictDoNothing()
            .returning();

          if (!created) {
            return {
              success: false,
              error: "Device is already assigned to this application",
            };
          }
          return {
            success: true,
            data: created,
            message: "Device assigned to application",
          };
        },
        {
          body: t.Object({ device_id: t.String() }),
        },
      )

      // ----------------------------------------------------------------
      // Unassign a device from an application (team owner/admin only)
      // ----------------------------------------------------------------
      .delete("/:app_id/devices/:device_id", async (ctx) => {
        const { org_id, team_id, app_id, device_id } = ctx.params;
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
            orgRole === "owner";
          if (!canRemove) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return {
              success: false,
              error:
                "TeamOwner, TeamAdmin or OrgOwner access required to unassign devices",
            };
          }
        }

        await db
          .delete(applicationDevices)
          .where(
            and(
              eq(applicationDevices.applicationId, Number(app_id)),
              eq(applicationDevices.deviceId, device_id),
            ),
          );
        return { success: true, message: "Device unassigned from application" };
      })

      // ----------------------------------------------------------------
      // List sensor types subscribed by an application
      // ----------------------------------------------------------------
      .get("/:app_id/sensor-types", async (ctx) => {
        const { app_id } = ctx.params;
        const rows = await db
          .select()
          .from(applicationSensorTypes)
          .where(eq(applicationSensorTypes.applicationId, Number(app_id)))
          .orderBy(applicationSensorTypes.sensorType);
        return { success: true, data: rows };
      })

      // ----------------------------------------------------------------
      // Subscribe application to a sensor type
      // ----------------------------------------------------------------
      .post(
        "/:app_id/sensor-types",
        async (ctx) => {
          const { org_id, team_id, app_id } = ctx.params;
          const { sensor_type, visibility = "team" } = ctx.body as {
            sensor_type: string;
            visibility?: "team" | "org" | "public";
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

          try {
            const [row] = await db
              .insert(applicationSensorTypes)
              .values({
                applicationId: Number(app_id),
                sensorType: sensor_type.trim().toLowerCase(),
                visibility,
                isPublic: visibility === "public",
              })
              .onConflictDoNothing()
              .returning();
            if (!row)
              return {
                success: false,
                error: "Sensor type already subscribed",
              };
            return { success: true, data: row };
          } catch (e: unknown) {
            throw e;
          }
        },
        {
          body: t.Object({
            sensor_type: t.String({ minLength: 1, maxLength: 100 }),
            visibility: t.Optional(
              t.Union([
                t.Literal("team"),
                t.Literal("org"),
                t.Literal("public"),
              ]),
            ),
          }),
        },
      )

      // ----------------------------------------------------------------
      // Unsubscribe application from a sensor type
      // ----------------------------------------------------------------
      .delete("/:app_id/sensor-types/:sensor_type", async (ctx) => {
        const { org_id, team_id, app_id, sensor_type } = ctx.params;
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

        await db
          .delete(applicationSensorTypes)
          .where(
            and(
              eq(applicationSensorTypes.applicationId, Number(app_id)),
              eq(applicationSensorTypes.sensorType, sensor_type),
            ),
          );
        return { success: true, message: "Sensor type unsubscribed" };
      })

      // ----------------------------------------------------------------
      // Update visibility of a sensor type
      // PATCH /:app_id/sensor-types/:sensor_type
      // ----------------------------------------------------------------
      .patch(
        "/:app_id/sensor-types/:sensor_type",
        async (ctx) => {
          const { org_id, team_id, app_id, sensor_type } = ctx.params;
          const { visibility } = ctx.body as {
            visibility: "team" | "org" | "public";
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

          const [updated] = await db
            .update(applicationSensorTypes)
            .set({ visibility, isPublic: visibility === "public" })
            .where(
              and(
                eq(applicationSensorTypes.applicationId, Number(app_id)),
                eq(applicationSensorTypes.sensorType, sensor_type),
              ),
            )
            .returning();
          if (!updated) {
            (ctx as unknown as { set: { status: number } }).set.status = 404;
            return { success: false, error: "Sensor type not found" };
          }
          return { success: true, data: updated };
        },
        {
          body: t.Object({
            visibility: t.Union([
              t.Literal("team"),
              t.Literal("org"),
              t.Literal("public"),
            ]),
          }),
        },
      )

      // ----------------------------------------------------------------
      // List devices in the app's team that match its sensor subscriptions
      // GET /:org_id/teams/:team_id/applications/:app_id/matched-devices
      // ----------------------------------------------------------------
      .get("/:app_id/matched-devices", async (ctx) => {
        const { app_id } = ctx.params;
        const appIdNum = Number(app_id);

        // Get the app's team_id
        const [app] = await db
          .select({ teamId: applications.teamId })
          .from(applications)
          .where(eq(applications.id, appIdNum))
          .limit(1);
        if (!app) {
          (ctx as unknown as { set: { status: number } }).set.status = 404;
          return { success: false, error: "Application not found" };
        }

        // Matched devices: join applicationSensorTypes → deviceSensors → deviceRegistry
        const rows = await db
          .selectDistinct({
            deviceId: deviceRegistry.id,
            deviceKey: deviceRegistry.deviceKey,
            deviceType: deviceRegistry.deviceType,
            eui: deviceRegistry.devEui,
            macAddress: deviceRegistry.macAddress,
            vendorName: deviceVendors.name,
            modelName: deviceModels.name,
            modelCode: deviceModels.code,
            sensorType: deviceSensors.sensorType,
            sensorUnit: deviceSensors.unit,
            isActive: deviceRegistry.isActive,
            connectionStatus: deviceRegistry.connectionStatus,
            lastHeartbeat: deviceRegistry.lastHeartbeat,
          })
          .from(applicationSensorTypes)
          .innerJoin(
            deviceSensors,
            eq(deviceSensors.sensorType, applicationSensorTypes.sensorType),
          )
          .innerJoin(
            deviceRegistry,
            and(
              eq(deviceRegistry.deviceModelId, deviceSensors.deviceModelId),
              eq(deviceRegistry.teamId, app.teamId),
              sql`${deviceRegistry.isActive} IS NOT FALSE`,
            ),
          )
          .innerJoin(
            deviceModels,
            eq(deviceModels.id, deviceRegistry.deviceModelId),
          )
          .innerJoin(deviceVendors, eq(deviceVendors.id, deviceModels.vendorId))
          .where(eq(applicationSensorTypes.applicationId, appIdNum))
          .orderBy(deviceRegistry.deviceKey, deviceSensors.sensorType);

        // Count distinct devices
        const [countRow] = await db
          .select({ n: sql<number>`count(distinct ${deviceRegistry.id})` })
          .from(applicationSensorTypes)
          .innerJoin(
            deviceSensors,
            eq(deviceSensors.sensorType, applicationSensorTypes.sensorType),
          )
          .innerJoin(
            deviceRegistry,
            and(
              eq(deviceRegistry.deviceModelId, deviceSensors.deviceModelId),
              eq(deviceRegistry.teamId, app.teamId),
              sql`${deviceRegistry.isActive} IS NOT FALSE`,
            ),
          )
          .where(eq(applicationSensorTypes.applicationId, appIdNum));

        return {
          success: true,
          data: rows.map((r) => ({
            device_id: r.deviceId,
            device_key: r.deviceKey,
            device_type: r.deviceType,
            eui: r.eui,
            mac_address: r.macAddress,
            vendor_name: r.vendorName,
            model_name: r.modelName,
            model_code: r.modelCode,
            sensor_type: r.sensorType,
            sensor_unit: r.sensorUnit,
            is_active: r.isActive,
            connection_status: r.connectionStatus,
            last_heartbeat: r.lastHeartbeat,
          })),
          total: Number(countRow?.n ?? 0),
        };
      })

      // ----------------------------------------------------------------
      // Get sensor values for an application
      // Returns the last N values per sensor type (N = app.redis_cache_size)
      // GET /:app_id/sensor-values
      // ----------------------------------------------------------------
      .get("/:app_id/sensor-values", async (ctx) => {
        const { org_id, team_id, app_id } = ctx.params;
        const auth = (ctx as unknown as { auth: AuthContext }).auth;

        if (auth.role !== "superAdmin") {
          const teamRole = await getTeamMemberRole(db, auth.userId, Number(team_id));
          const orgRole = await getOrgMemberRole(db, auth.userId, Number(org_id));
          if (!teamRole && !orgRole) {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Team or org membership required" };
          }
        }

        const [app] = await db
          .select({ redisCacheSize: applications.redisCacheSize })
          .from(applications)
          .where(and(eq(applications.id, Number(app_id)), eq(applications.teamId, Number(team_id))))
          .limit(1);
        if (!app) {
          (ctx as unknown as { set: { status: number } }).set.status = 404;
          return { success: false, error: "Application not found" };
        }

        const limit = app.redisCacheSize ?? 1;

        // Fetch last N values per sensor type using RANK()
        const rows = await db.execute(
          sql`
            SELECT id, application_id, sensor_type, sensor_value, recorded_at, created_at
            FROM (
              SELECT *,
                     RANK() OVER (PARTITION BY sensor_type ORDER BY recorded_at DESC) AS rn
              FROM application_sensor_values
              WHERE application_id = ${Number(app_id)}
            ) ranked
            WHERE rn <= ${limit}
            ORDER BY sensor_type ASC, recorded_at DESC
          `,
        );

        return {
          success: true,
          redis_cache_size: limit,
          data: (rows as unknown as { id: number; application_id: number; sensor_type: string; sensor_value: unknown; recorded_at: string; created_at: string }[]).map((r) => ({
            id: r.id,
            application_id: r.application_id,
            sensor_type: r.sensor_type,
            sensor_value: r.sensor_value,
            recorded_at: r.recorded_at,
            created_at: r.created_at,
          })),
        };
      })

      // ----------------------------------------------------------------
      // Push a new sensor value for an application
      // Automatically prunes to keep only the last N values per sensor type
      // POST /:app_id/sensor-values
      // (Primarily used by the MQTT/NATS adapter — future realtime integration)
      // ----------------------------------------------------------------
      .post(
        "/:app_id/sensor-values",
        async (ctx) => {
          const { org_id, team_id, app_id } = ctx.params;
          const { sensor_type, sensor_value, recorded_at } = ctx.body as {
            sensor_type: string;
            sensor_value: unknown;
            recorded_at?: string;
          };
          const auth = (ctx as unknown as { auth: AuthContext }).auth;

          if (auth.role !== "superAdmin") {
            const teamRole = await getTeamMemberRole(db, auth.userId, Number(team_id));
            const orgRole = await getOrgMemberRole(db, auth.userId, Number(org_id));
            const canWrite =
              teamRole === "teamowner" ||
              teamRole === "teamadmin" ||
              teamRole === "teammember" ||
              orgRole === "owner" ||
              orgRole === "admin";
            if (!canWrite) {
              (ctx as unknown as { set: { status: number } }).set.status = 403;
              return { success: false, error: "Team membership required" };
            }
          }

          const [app] = await db
            .select({ redisCacheSize: applications.redisCacheSize })
            .from(applications)
            .where(and(eq(applications.id, Number(app_id)), eq(applications.teamId, Number(team_id))))
            .limit(1);
          if (!app) {
            (ctx as unknown as { set: { status: number } }).set.status = 404;
            return { success: false, error: "Application not found" };
          }

          const [inserted] = await db
            .insert(applicationSensorValues)
            .values({
              applicationId: Number(app_id),
              sensorType: sensor_type,
              sensorValue: sensor_value as Record<string, unknown>,
              recordedAt: recorded_at ? new Date(recorded_at) : new Date(),
            })
            .returning();

          // Prune: keep only the last N rows per sensor_type
          const cacheSize = app.redisCacheSize ?? 1;
          await db.execute(
            sql`
              DELETE FROM application_sensor_values
              WHERE application_id = ${Number(app_id)}
                AND sensor_type = ${sensor_type}
                AND id NOT IN (
                  SELECT id FROM application_sensor_values
                  WHERE application_id = ${Number(app_id)}
                    AND sensor_type = ${sensor_type}
                  ORDER BY recorded_at DESC
                  LIMIT ${cacheSize}
                )
            `,
          );

          return { success: true, data: inserted };
        },
        {
          body: t.Object({
            sensor_type: t.String({ minLength: 1, maxLength: 100 }),
            sensor_value: t.Optional(t.Any()),
            recorded_at: t.Optional(t.String()),
          }),
        },
      )
  );
}
