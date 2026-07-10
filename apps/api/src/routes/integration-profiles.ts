/**
 * Integration Profiles API Routes
 *
 * An integration profile bundles input + output services for an organization.
 * Applications reference a profile to route telemetry from devices to outputs.
 * Profiles are the ONLY routing layer — no per-device overrides, no service defaults.
 *
 * GET    /api/v1/orgs/:org_id/integration-profiles              — list profiles
 * POST   /api/v1/orgs/:org_id/integration-profiles              — create profile
 * GET    /api/v1/orgs/:org_id/integration-profiles/:id          — get profile + services
 * PUT    /api/v1/orgs/:org_id/integration-profiles/:id          — update profile
 * DELETE /api/v1/orgs/:org_id/integration-profiles/:id          — delete profile
 * GET    /api/v1/orgs/:org_id/integration-profiles/:id/services — list services
 * POST   /api/v1/orgs/:org_id/integration-profiles/:id/services — add service
 * DELETE /api/v1/orgs/:org_id/integration-profiles/:id/services/:service_id — remove
 */

import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, getOrgMemberRole, requireAuth } from "../db/auth";
import {
  integrationProfileServices,
  integrationProfiles,
  serviceRegistry,
} from "../db/schema";

export function createIntegrationProfileRoutes(db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/orgs/:org_id/integration-profiles" })
    .use(requireAuth())

    // ── LIST ────────────────────────────────────────────────────────────────
    .get("/", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Not a member of this organization" };
        }
      }

      const profiles = await db
        .select()
        .from(integrationProfiles)
        .where(eq(integrationProfiles.orgId, orgId))
        .orderBy(integrationProfiles.name);

      return { success: true, data: profiles };
    })

    // ── CREATE ──────────────────────────────────────────────────────────────
    .post(
      "/",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const orgId = Number(ctx.params.org_id);

        if (auth.role !== "superAdmin") {
          const role = await getOrgMemberRole(db, auth.userId, orgId);
          if (!role || role === "member") {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Insufficient permissions" };
          }
        }

        const { name, description, isGlobal } = ctx.body as {
          name: string;
          description?: string;
          isGlobal?: boolean;
        };

        const [created] = await db
          .insert(integrationProfiles)
          .values({
            orgId,
            name,
            description: description ?? null,
            isGlobal: isGlobal ?? false,
            createdBy: auth.userId,
          })
          .returning();

        return { success: true, data: created };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          description: t.Optional(t.String()),
          isGlobal: t.Optional(t.Boolean()),
        }),
      },
    )

    // ── GET ONE ─────────────────────────────────────────────────────────────
    .get("/:id", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);
      const profileId = Number(ctx.params.id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Not a member of this organization" };
        }
      }

      const [profile] = await db
        .select()
        .from(integrationProfiles)
        .where(
          and(
            eq(integrationProfiles.id, profileId),
            eq(integrationProfiles.orgId, orgId),
          ),
        )
        .limit(1);

      if (!profile) {
        (ctx as unknown as { set: { status: number } }).set.status = 404;
        return { success: false, error: "Profile not found" };
      }

      const services = await db
        .select({
          id: integrationProfileServices.id,
          serviceId: integrationProfileServices.serviceId,
          serviceName: serviceRegistry.name,
          serviceType: serviceRegistry.serviceType,
          role: integrationProfileServices.role,
          priority: integrationProfileServices.priority,
          isActive: integrationProfileServices.isActive,
          topicTemplate: integrationProfileServices.topicTemplate,
        })
        .from(integrationProfileServices)
        .innerJoin(
          serviceRegistry,
          eq(integrationProfileServices.serviceId, serviceRegistry.id),
        )
        .where(eq(integrationProfileServices.profileId, profileId))
        .orderBy(integrationProfileServices.role, integrationProfileServices.priority);

      return { success: true, data: { ...profile, services } };
    })

    // ── UPDATE ──────────────────────────────────────────────────────────────
    .put(
      "/:id",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const orgId = Number(ctx.params.org_id);
        const profileId = Number(ctx.params.id);

        if (auth.role !== "superAdmin") {
          const role = await getOrgMemberRole(db, auth.userId, orgId);
          if (!role || role === "member") {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Insufficient permissions" };
          }
        }

        const body = ctx.body as {
          name?: string;
          description?: string;
          isGlobal?: boolean;
        };

        const [updated] = await db
          .update(integrationProfiles)
          .set({
            ...(body.name !== undefined && { name: body.name }),
            ...(body.description !== undefined && { description: body.description }),
            ...(body.isGlobal !== undefined && { isGlobal: body.isGlobal }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(integrationProfiles.id, profileId),
              eq(integrationProfiles.orgId, orgId),
            ),
          )
          .returning();

        if (!updated) {
          (ctx as unknown as { set: { status: number } }).set.status = 404;
          return { success: false, error: "Profile not found" };
        }

        return { success: true, data: updated };
      },
      {
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1 })),
          description: t.Optional(t.String()),
          isGlobal: t.Optional(t.Boolean()),
        }),
      },
    )

    // ── DELETE ──────────────────────────────────────────────────────────────
    .delete("/:id", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);
      const profileId = Number(ctx.params.id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role || role === "member") {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Insufficient permissions" };
        }
      }

      const [deleted] = await db
        .delete(integrationProfiles)
        .where(
          and(
            eq(integrationProfiles.id, profileId),
            eq(integrationProfiles.orgId, orgId),
          ),
        )
        .returning({ id: integrationProfiles.id });

      if (!deleted) {
        (ctx as unknown as { set: { status: number } }).set.status = 404;
        return { success: false, error: "Profile not found" };
      }

      return { success: true };
    })

    // ── LIST SERVICES ────────────────────────────────────────────────────────
    .get("/:id/services", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);
      const profileId = Number(ctx.params.id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Not a member of this organization" };
        }
      }

      const rows = await db
        .select({
          id: integrationProfileServices.id,
          serviceId: integrationProfileServices.serviceId,
          serviceName: serviceRegistry.name,
          serviceType: serviceRegistry.serviceType,
          role: integrationProfileServices.role,
          priority: integrationProfileServices.priority,
          isActive: integrationProfileServices.isActive,
          topicTemplate: integrationProfileServices.topicTemplate,
        })
        .from(integrationProfileServices)
        .innerJoin(
          serviceRegistry,
          eq(integrationProfileServices.serviceId, serviceRegistry.id),
        )
        .where(eq(integrationProfileServices.profileId, profileId))
        .orderBy(integrationProfileServices.role, integrationProfileServices.priority);

      return { success: true, data: rows };
    })

    // ── ADD SERVICE ──────────────────────────────────────────────────────────
    .post(
      "/:id/services",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const orgId = Number(ctx.params.org_id);
        const profileId = Number(ctx.params.id);

        if (auth.role !== "superAdmin") {
          const role = await getOrgMemberRole(db, auth.userId, orgId);
          if (!role || role === "member") {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Insufficient permissions" };
          }
        }

        // Verify the profile belongs to this org
        const [profile] = await db
          .select({ id: integrationProfiles.id })
          .from(integrationProfiles)
          .where(
            and(
              eq(integrationProfiles.id, profileId),
              eq(integrationProfiles.orgId, orgId),
            ),
          )
          .limit(1);

        if (!profile) {
          (ctx as unknown as { set: { status: number } }).set.status = 404;
          return { success: false, error: "Profile not found" };
        }

        const { serviceId, role, priority, topicTemplate } = ctx.body as {
          serviceId: number;
          role: "input" | "output";
          priority?: number;
          topicTemplate?: string;
        };

        const [entry] = await db
          .insert(integrationProfileServices)
          .values({
            profileId,
            serviceId,
            role,
            priority: priority ?? 0,
            isActive: true,
            topicTemplate: topicTemplate ?? null,
          })
          .onConflictDoUpdate({
            target: [
              integrationProfileServices.profileId,
              integrationProfileServices.serviceId,
              integrationProfileServices.role,
            ],
            set: {
              priority: priority ?? 0,
              isActive: true,
              topicTemplate: topicTemplate ?? null,
            },
          })
          .returning();

        return { success: true, data: entry };
      },
      {
        body: t.Object({
          serviceId: t.Number(),
          role: t.Union([t.Literal("input"), t.Literal("output")]),
          priority: t.Optional(t.Number()),
          topicTemplate: t.Optional(t.String()),
        }),
      },
    )

    // ── REMOVE SERVICE ───────────────────────────────────────────────────────
    .delete("/:id/services/:service_id", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);
      const profileId = Number(ctx.params.id);
      const serviceId = Number(ctx.params.service_id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role || role === "member") {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Insufficient permissions" };
        }
      }

      const [deleted] = await db
        .delete(integrationProfileServices)
        .where(
          and(
            eq(integrationProfileServices.profileId, profileId),
            eq(integrationProfileServices.serviceId, serviceId),
          ),
        )
        .returning({ id: integrationProfileServices.id });

      if (!deleted) {
        (ctx as unknown as { set: { status: number } }).set.status = 404;
        return { success: false, error: "Service entry not found in profile" };
      }

      return { success: true };
    })

    // ── ALL ORG DEVICE ASSIGNMENTS ──────────────────────────────────────────
    // Returns {device_id, profile_id, profile_name} for every device in the
    // org that is currently assigned to at least one profile. Used by the
    // devices sheet to highlight cross-profile conflicts.
    .get("/device-assignments", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Not a member of this organization" };
        }
      }

      const rows = await db.execute(sql`
        SELECT DISTINCT ON (d.id)
          d.id        AS device_id,
          ip.id       AS profile_id,
          ip.name     AS profile_name
        FROM devices d
        JOIN device_services              ds  ON ds.device_id  = d.id AND ds.is_active = true
        JOIN integration_profile_services ips ON ips.service_id = ds.service_id
        JOIN integration_profiles         ip  ON ip.id          = ips.profile_id
        WHERE d.organization_id = ${orgId}
        ORDER BY d.id, ip.id
      `);

      return { success: true, data: rows.rows };
    })

    // ── LIST DEVICES ─────────────────────────────────────────────────────────
    // Returns devices that have active device_services rows pointing to any
    // service in this profile — i.e. devices currently routed by this profile.
    .get("/:id/devices", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);
      const profileId = Number(ctx.params.id);

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role) {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Not a member of this organization" };
        }
      }

      const rows = await db.execute(sql`
        SELECT DISTINCT ON (d.id)
          d.id,
          d.device_key,
          d.is_active,
          dm.name  AS device_model_name,
          dv.name  AS vendor_name
        FROM devices d
        JOIN device_services          ds  ON ds.device_id  = d.id
        JOIN integration_profile_services ips ON ips.service_id = ds.service_id
        JOIN device_models            dm  ON dm.id         = d.device_model_id
        JOIN device_vendors           dv  ON dv.id         = dm.vendor_id
        WHERE ips.profile_id    = ${profileId}
          AND ds.is_active      = true
          AND d.organization_id = ${orgId}
        ORDER BY d.id, d.device_key
      `);

      return { success: true, data: rows.rows };
    })

    // ── ASSIGN DEVICES ───────────────────────────────────────────────────────
    // For each device_id, inserts device_services rows (one per service in the
    // profile). ON CONFLICT sets is_active = true to re-activate if needed.
    .post(
      "/:id/devices",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const orgId = Number(ctx.params.org_id);
        const profileId = Number(ctx.params.id);

        if (auth.role !== "superAdmin") {
          const role = await getOrgMemberRole(db, auth.userId, orgId);
          if (!role || role === "member") {
            (ctx as unknown as { set: { status: number } }).set.status = 403;
            return { success: false, error: "Insufficient permissions" };
          }
        }

        const { device_ids } = ctx.body as { device_ids: string[] };
        if (!device_ids || device_ids.length === 0)
          return { success: true, data: { assigned: 0 } };

        // Conflict check: warn if a device already routes a SHARED service via another profile
        for (const deviceId of device_ids) {
          const conflict = await db.execute(sql`
            SELECT DISTINCT ip.name AS profile_name
            FROM device_services          ds
            JOIN integration_profile_services ips ON ips.service_id = ds.service_id
            JOIN integration_profiles         ip  ON ip.id          = ips.profile_id
            WHERE ds.device_id   = ${deviceId}::uuid
              AND ds.is_active   = true
              AND ips.profile_id != ${profileId}
              AND ips.service_id IN (
                SELECT service_id FROM integration_profile_services
                WHERE  profile_id = ${profileId}
              )
            LIMIT 1
          `);
          if (conflict.rows.length > 0) {
            const row = conflict.rows[0] as { profile_name: string };
            (ctx as unknown as { set: { status: number } }).set.status = 409;
            return {
              success: false,
              error: `Device is already assigned to profile "${row.profile_name}" via a shared service. Remove it from that profile first.`,
            };
          }
        }

        for (const deviceId of device_ids) {
          await db.execute(sql`
            INSERT INTO device_services (device_id, service_id, role, is_active, priority, created_at)
            SELECT ${deviceId}::uuid, ips.service_id, ips.role, true, ips.priority, now()
            FROM integration_profile_services ips
            WHERE ips.profile_id = ${profileId}
              AND ips.is_active  = true
            ON CONFLICT (device_id, service_id) DO UPDATE SET is_active = true
          `);
        }

        return { success: true, data: { assigned: device_ids.length } };
      },
      {
        body: t.Object({
          device_ids: t.Array(t.String()),
        }),
      },
    )

    // ── UNASSIGN DEVICE ──────────────────────────────────────────────────────
    // Deletes all device_services rows for this device that belong to any
    // service in the profile.
    .delete("/:id/devices/:device_id", async (ctx) => {
      const auth = (ctx as unknown as { auth: AuthContext }).auth;
      const orgId = Number(ctx.params.org_id);
      const profileId = Number(ctx.params.id);
      const deviceId = ctx.params.device_id;

      if (auth.role !== "superAdmin") {
        const role = await getOrgMemberRole(db, auth.userId, orgId);
        if (!role || role === "member") {
          (ctx as unknown as { set: { status: number } }).set.status = 403;
          return { success: false, error: "Insufficient permissions" };
        }
      }

      await db.execute(sql`
        DELETE FROM device_services
        WHERE device_id = ${deviceId}::uuid
          AND service_id IN (
            SELECT service_id
            FROM   integration_profile_services
            WHERE  profile_id = ${profileId}
          )
      `);

      return { success: true };
    });
}
