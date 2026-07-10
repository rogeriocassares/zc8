/**
 * Plan Configuration Routes
 *
 * Manages per-plan limits that govern:
 *  - maxOrgs: how many orgs a user of this plan can own (-1 = unlimited)
 *  - maxTeamsPerOrg: top-level teams per org (-1 = unlimited)
 *  - maxAppsPerTeam: applications per team (-1 = unlimited, 0 = none)
 *  - maxDevicesPerTeam: devices assignable per application (-1 = unlimited)
 *
 * GET  /api/v1/plan-config           — list all (auth required)
 * PUT  /api/v1/plan-config/:plan     — update limits (superAdmin only)
 */

import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import { type Plan, planConfigurations } from "../db/schema";

/** Default hard-coded config as fallback if DB row is missing. */
export const DEFAULT_PLAN_CONFIG: Record<
  Plan,
  {
    maxOrgs: number;
    maxTeamsPerOrg: number;
    maxAppsPerTeam: number;
    maxDevicesPerTeam: number;
    maxMembersPerOrg: number;
  }
> = {
  user: { maxOrgs: 0, maxTeamsPerOrg: 0, maxAppsPerTeam: 0, maxDevicesPerTeam: 0, maxMembersPerOrg: 0 },
  hobby: { maxOrgs: 1, maxTeamsPerOrg: 1, maxAppsPerTeam: 3, maxDevicesPerTeam: 10, maxMembersPerOrg: 5 },
  pro: { maxOrgs: 1, maxTeamsPerOrg: 5, maxAppsPerTeam: 10, maxDevicesPerTeam: 50, maxMembersPerOrg: 20 },
  premium: { maxOrgs: -1, maxTeamsPerOrg: 20, maxAppsPerTeam: 50, maxDevicesPerTeam: -1, maxMembersPerOrg: -1 },
  enterprise: { maxOrgs: -1, maxTeamsPerOrg: -1, maxAppsPerTeam: -1, maxDevicesPerTeam: -1, maxMembersPerOrg: -1 },
};

/** Fetch plan config from DB, falling back to defaults. */
export async function getPlanConfig(
  db: DrizzleDB,
  plan: Plan,
): Promise<{
  maxOrgs: number;
  maxTeamsPerOrg: number;
  maxAppsPerTeam: number;
  maxDevicesPerTeam: number;
  maxMembersPerOrg: number;
}> {
  const row = await db.query.planConfigurations.findFirst({
    where: eq(planConfigurations.plan, plan),
  });
  if (!row) return DEFAULT_PLAN_CONFIG[plan];
  return {
    maxOrgs: row.maxOrgs,
    maxTeamsPerOrg: row.maxTeamsPerOrg,
    maxAppsPerTeam: row.maxAppsPerTeam,
    maxDevicesPerTeam: row.maxDevicesPerTeam,
    maxMembersPerOrg: row.maxMembersPerOrg,
  };
}

export function createPlanConfigRoutes(db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/plan-config" })
    .use(requireAuth())

    .get("/", async () => {
      const rows = await db.query.planConfigurations.findMany();
      // Ensure all plans are represented (merge DB rows with defaults)
      const plans: Plan[] = ["user", "hobby", "pro", "premium", "enterprise"];
      const byPlan = Object.fromEntries(rows.map((r) => [r.plan, r]));
      const data = plans.map((p) => {
        const row = byPlan[p];
        return {
          plan: p,
          max_orgs: row?.maxOrgs ?? DEFAULT_PLAN_CONFIG[p].maxOrgs,
          max_teams_per_org: row?.maxTeamsPerOrg ?? DEFAULT_PLAN_CONFIG[p].maxTeamsPerOrg,
          max_apps_per_team: row?.maxAppsPerTeam ?? DEFAULT_PLAN_CONFIG[p].maxAppsPerTeam,
          max_devices_per_team: row?.maxDevicesPerTeam ?? DEFAULT_PLAN_CONFIG[p].maxDevicesPerTeam,
          max_members_per_org: row?.maxMembersPerOrg ?? DEFAULT_PLAN_CONFIG[p].maxMembersPerOrg,
          updated_at: row?.updatedAt ?? null,
          updated_by: row?.updatedBy ?? null,
        };
      });
      return { success: true, data };
    })

    .put(
      "/:plan",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        if (auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Super admin access required" };
        }

        const planParam = ctx.params.plan as Plan;
        const validPlans: Plan[] = ["user", "hobby", "pro", "premium", "enterprise"];
        if (!validPlans.includes(planParam)) {
          ctx.set.status = 400;
          return { success: false, error: "Invalid plan" };
        }

        const { max_orgs, max_teams_per_org, max_apps_per_team, max_devices_per_team, max_members_per_org } =
          ctx.body as {
            max_orgs?: number;
            max_teams_per_org?: number;
            max_apps_per_team?: number;
            max_devices_per_team?: number;
            max_members_per_org?: number;
          };

        const updates: Record<string, unknown> = {
          updatedAt: new Date(),
          updatedBy: auth.userId,
        };
        if (max_orgs !== undefined) updates.maxOrgs = max_orgs;
        if (max_teams_per_org !== undefined) updates.maxTeamsPerOrg = max_teams_per_org;
        if (max_apps_per_team !== undefined) updates.maxAppsPerTeam = max_apps_per_team;
        if (max_devices_per_team !== undefined) updates.maxDevicesPerTeam = max_devices_per_team;
        if (max_members_per_org !== undefined) updates.maxMembersPerOrg = max_members_per_org;

        // Upsert: insert default row if not exists, then update
        await db
          .insert(planConfigurations)
          .values({
            plan: planParam,
            ...DEFAULT_PLAN_CONFIG[planParam],
            updatedAt: new Date(),
            updatedBy: auth.userId,
          })
          .onConflictDoNothing();

        const result = await db
          .update(planConfigurations)
          .set(updates)
          .where(eq(planConfigurations.plan, planParam))
          .returning();

        return { success: true, data: result[0] };
      },
      {
        body: t.Object({
          max_orgs: t.Optional(t.Number({ minimum: -1 })),
          max_teams_per_org: t.Optional(t.Number({ minimum: -1 })),
          max_apps_per_team: t.Optional(t.Number({ minimum: -1 })),
          max_devices_per_team: t.Optional(t.Number({ minimum: -1 })),
          max_members_per_org: t.Optional(t.Number({ minimum: -1 })),
        }),
      },
    );
}
