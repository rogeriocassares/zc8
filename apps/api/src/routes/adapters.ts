import { Elysia } from "elysia";
import type { AdapterManagerService } from "../lib/adapter-manager-service.ts";
import type { AdapterType, AdapterVendor } from "../lib/adapter-types.ts";

export function createAdapterRoutes(adapterManagerService: AdapterManagerService) {
  return new Elysia({ name: "adapter-routes" })
    // GET /api/adapters/types — List supported adapter types
    .get("/api/adapters/types", () => ({
      types: adapterManagerService.getSupportedTypes(),
    }))

    // GET /api/adapters/types/:type/vendors
    .get("/api/adapters/types/:type/vendors", ({ params }) => {
      try {
        const type = params.type as AdapterType;
        const vendors = adapterManagerService.getSupportedVendors(type);
        return { type, vendors };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // GET /api/adapters/types/:type/vendors/:vendor/schema
    .get("/api/adapters/types/:type/vendors/:vendor/schema", ({ params }) => {
      try {
        const type = params.type as AdapterType;
        const vendor = params.vendor as AdapterVendor;
        const s = adapterManagerService.getVendorSchema(type, vendor);
        return s;
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // GET /api/organizations/:org_id/adapters
    .get("/api/organizations/:org_id/adapters", async ({ params, query }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const adapters = await adapterManagerService.listAdapters(org_id, {
          adapter_type: query.type as AdapterType,
          adapter_vendor: query.vendor as AdapterVendor,
          enabled: query.enabled ? query.enabled === "true" : undefined,
        });
        return {
          org_id,
          adapters: adapters.map((a) => ({
            id: a.id,
            adapter_type: a.adapter_type,
            adapter_vendor: a.adapter_vendor,
            name: a.name,
            enabled: a.enabled,
            created_at: a.created_at,
            updated_at: a.updated_at,
          })),
        };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // POST /api/organizations/:org_id/adapters
    .post("/api/organizations/:org_id/adapters", async ({ params, body }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const { adapter_type, adapter_vendor, name, config, enabled } = body as {
          adapter_type: AdapterType;
          adapter_vendor: AdapterVendor;
          name: string;
          config: Record<string, unknown>;
          enabled?: boolean;
        };
        const adapter = await adapterManagerService.createAdapter(org_id, {
          adapter_type,
          adapter_vendor,
          name,
          config,
          enabled,
        });
        return { status: 201, adapter };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // GET /api/organizations/:org_id/adapters/:config_id
    .get("/api/organizations/:org_id/adapters/:config_id", async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const adapter = await adapterManagerService.getAdapter(org_id, params.config_id);
        return adapter;
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // PUT /api/organizations/:org_id/adapters/:config_id
    .put("/api/organizations/:org_id/adapters/:config_id", async ({ params, body }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const { name, config, enabled } = body as {
          name?: string;
          config?: Record<string, unknown>;
          enabled?: boolean;
        };
        const adapter = await adapterManagerService.updateAdapter(
          org_id,
          params.config_id,
          { name, config, enabled },
        );
        return { status: 200, adapter };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // DELETE /api/organizations/:org_id/adapters/:config_id
    .delete("/api/organizations/:org_id/adapters/:config_id", async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        await adapterManagerService.deleteAdapter(org_id, params.config_id);
        return { status: 204 };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // POST /api/organizations/:org_id/adapters/:config_id/start
    .post("/api/organizations/:org_id/adapters/:config_id/start", async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const instance = await adapterManagerService.startAdapter(org_id, params.config_id);
        return { status: 200, instance };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // POST /api/organizations/:org_id/adapters/:config_id/stop
    .post("/api/organizations/:org_id/adapters/:config_id/stop", async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        await adapterManagerService.stopAdapter(org_id, params.config_id);
        return { status: 204 };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // POST /api/organizations/:org_id/adapters/:config_id/restart
    .post("/api/organizations/:org_id/adapters/:config_id/restart", async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const instance = await adapterManagerService.restartAdapter(org_id, params.config_id);
        return { status: 200, instance };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    })

    // GET /api/organizations/:org_id/adapters/:config_id/health
    .get("/api/organizations/:org_id/adapters/:config_id/health", async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const health = await adapterManagerService.getAdapterHealth(org_id, params.config_id);
        return health;
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    });
}
