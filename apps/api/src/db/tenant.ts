/**
 * Tenant-Scoped Query Helpers
 *
 * Every query that touches org-owned data MUST go through these helpers
 * so that the WHERE org_id = $orgId clause is guaranteed.
 *
 * Usage:
 * ```ts
 * const devices = await tenantQuery(db, auth).devices.findMany();
 * ```
 */

import { and, eq, type SQL } from "drizzle-orm";
import type { DrizzleDB } from ".";
import type { AuthContext } from "./auth";
import {
  deviceModels,
  deviceRegistry,
  deviceVendors,
  memberships,
  serviceRegistry,
  teams,
} from "./schema";

// ─── Core scoping helper ───────────────────────────────────────────────────────

/**
 * Returns a type-safe WHERE condition that scopes a query to the
 * authenticated user's organization.
 *
 * @example
 * ```ts
 * db.select().from(deviceRegistry).where(orgScope(deviceRegistry, auth));
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle column type is complex
export function orgScope<T extends { organizationId: any }>(
  table: T,
  auth: AuthContext,
): SQL {
  return eq(table.organizationId, auth.orgId);
}

// ─── Tenant-scoped query object ────────────────────────────────────────────────

export function tenantQuery(db: DrizzleDB, auth: AuthContext) {
  const orgId = auth.orgId;
  if (orgId == null) throw new Error("Organization context required");

  return {
    // ── Devices ──────────────────────────────────────────────────────
    devices: {
      async findMany(opts?: { teamId?: number; isActive?: boolean }) {
        const conditions: SQL[] = [eq(deviceRegistry.organizationId, orgId)];
        if (opts?.teamId != null)
          conditions.push(eq(deviceRegistry.teamId, opts.teamId));
        if (opts?.isActive != null)
          conditions.push(eq(deviceRegistry.isActive, opts.isActive));

        return db
          .select({
            id: deviceRegistry.id,
            deviceKey: deviceRegistry.deviceKey,
            deviceModelId: deviceRegistry.deviceModelId,
            deviceType: deviceRegistry.deviceType,
            devEui: deviceRegistry.devEui,
            macAddress: deviceRegistry.macAddress,
            organizationId: deviceRegistry.organizationId,
            teamId: deviceRegistry.teamId,
            isActive: deviceRegistry.isActive,
            isPublic: deviceRegistry.isPublic,
            isGlobal: deviceRegistry.isGlobal,
            connectionStatus: deviceRegistry.connectionStatus,
            metadata: deviceRegistry.metadata,
            createdAt: deviceRegistry.createdAt,
            updatedAt: deviceRegistry.updatedAt,
            vendorName: deviceVendors.name,
            modelName: deviceModels.name,
            modelCode: deviceModels.code,
          })
          .from(deviceRegistry)
          .innerJoin(
            deviceModels,
            eq(deviceRegistry.deviceModelId, deviceModels.id),
          )
          .innerJoin(deviceVendors, eq(deviceModels.vendorId, deviceVendors.id))
          .where(and(...conditions))
          .orderBy(deviceRegistry.createdAt);
      },

      async findById(deviceId: string) {
        const [device] = await db
          .select()
          .from(deviceRegistry)
          .where(
            and(
              eq(deviceRegistry.id, deviceId),
              eq(deviceRegistry.organizationId, orgId),
            ),
          )
          .limit(1);
        return device ?? null;
      },
    },

    // ── Services (formerly Integrations/Transports) ──────────────────────────
    transports: {
      async findMany(opts?: { teamId?: number }) {
        const conditions: SQL[] = [eq(serviceRegistry.organizationId, orgId)];
        if (opts?.teamId != null)
          conditions.push(eq(serviceRegistry.teamId, opts.teamId));

        return db
          .select()
          .from(serviceRegistry)
          .where(and(...conditions))
          .orderBy(serviceRegistry.createdAt);
      },

      async findById(serviceId: number) {
        const [t] = await db
          .select()
          .from(serviceRegistry)
          .where(
            and(
              eq(serviceRegistry.id, serviceId),
              eq(serviceRegistry.organizationId, orgId),
            ),
          )
          .limit(1);
        return t ?? null;
      },
    },

    // ── Teams ────────────────────────────────────────────────────────
    teams: {
      async findMany() {
        return db
          .select()
          .from(teams)
          .where(eq(teams.organizationId, orgId))
          .orderBy(teams.name);
      },

      async findById(teamId: number) {
        const [team] = await db
          .select()
          .from(teams)
          .where(and(eq(teams.id, teamId), eq(teams.organizationId, orgId)))
          .limit(1);
        return team ?? null;
      },
    },

    // ── Members ──────────────────────────────────────────────────────
    members: {
      async findMany() {
        return db
          .select()
          .from(memberships)
          .where(eq(memberships.orgId, orgId))
          .orderBy(memberships.createdAt);
      },
    },
  };
}
