/**
 * Multi-Organization Multi-Broker API Routes
 *
 * Endpoints for managing:
 * - Device routing rules (devices → adapters/brokers)
 * - External broker/endpoint connections
 * - LNS composite adapters
 */

import { Elysia, t } from "elysia";

export interface IDeviceRoutingManager {
  createRule(org_id: number, req: any): Promise<any>;
  getRulesForOrg(org_id: number): Promise<any[]>;
  updateRule(org_id: number, ruleId: string, req: any): Promise<any>;
  deleteRule(org_id: number, ruleId: string): Promise<void>;
}

export interface IExternalBrokerManager {
  createBrokerConnection(
    org_id: number,
    adapterConfigId: string,
    req: any,
  ): Promise<any>;
  getBrokerConnectionsForAdapter(
    org_id: number,
    adapterConfigId: string,
  ): Promise<any[]>;
  getBrokerConnectionsForOrg(org_id: number): Promise<any[]>;
  updateBrokerStatus(brokerConnectionId: string, status: string): Promise<void>;
  testBrokerConnection(brokerConnectionId: string): Promise<{
    success: boolean;
    message: string;
  }>;
}

export interface ILNSCompositeManager {
  createLNSAdapter(org_id: number, req: any): Promise<any>;
  getLNSAdapters(org_id: number): Promise<any[]>;
  getLNSAdapter(org_id: number, adapterId: string): Promise<any>;
  updateLNSAdapter(org_id: number, adapterId: string, req: any): Promise<any>;
}

/**
 * Create API routes for multi-org/multi-broker management
 */
export function createMultiOrgMultiBrokerRoutes(
  deviceRoutingManager: IDeviceRoutingManager,
  externalBrokerManager: IExternalBrokerManager,
  lnsCompositeManager: ILNSCompositeManager,
) {
  return new Elysia({ prefix: "/api/v1/orgs/:org_id" })
    .get("/device-routing/rules", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const rules = await deviceRoutingManager.getRulesForOrg(org_id);
      return {
        success: true,
        data: {
          org_id,
          rules,
          total: rules.length,
        },
      };
    })

    // ============================================================
    // Device Routing Rule Endpoints
    // ============================================================

    .post(
      "/device-routing/rules",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const rule = await deviceRoutingManager.createRule(org_id, ctx.body);
        return {
          success: true,
          data: rule,
          message: `Device routing rule created for org ${org_id}`,
        };
      },
      {
        body: t.Object({
          device_model: t.Optional(t.String()),
          device_class: t.Optional(t.String()),
          vendor_name: t.Optional(t.String()),
          adapter_type: t.String(),
          adapter_vendor: t.String(),
          adapter_config_id: t.Optional(t.String()),
          target_broker_url: t.Optional(t.String()),
          target_endpoint_url: t.Optional(t.String()),
          target_gw_id: t.Optional(t.String()),
          priority: t.Number({ minimum: 0, maximum: 100 }),
          weight: t.Optional(t.Number()),
        }),
      },
    )

    .put(
      "/device-routing/rules/:rule_id",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const rule_id = ctx.params.rule_id;
        const updated = await deviceRoutingManager.updateRule(
          org_id,
          rule_id,
          ctx.body,
        );
        return {
          success: true,
          data: updated,
          message: "Device routing rule updated",
        };
      },
      {
        body: t.Object({
          priority: t.Optional(t.Number()),
          weight: t.Optional(t.Number()),
          enabled: t.Optional(t.Boolean()),
        }),
      },
    )

    .delete("/device-routing/rules/:rule_id", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const rule_id = ctx.params.rule_id;
      await deviceRoutingManager.deleteRule(org_id, rule_id);
      return {
        success: true,
        message: `Device routing rule ${rule_id} deleted`,
      };
    })

    // ============================================================
    // External Broker/Endpoint Endpoints
    // ============================================================

    .post(
      "/adapters/:adapter_config_id/brokers",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const adapter_config_id = ctx.params.adapter_config_id;
        const broker = await externalBrokerManager.createBrokerConnection(
          org_id,
          adapter_config_id,
          ctx.body,
        );
        return {
          success: true,
          data: broker,
          message: `Broker connection added to adapter ${adapter_config_id}`,
        };
      },
      {
        body: t.Object({
          connection_type: t.String(), // mqtt_broker, http_endpoint, grpc_server
          connection_url: t.String(),
          broker_host: t.Optional(t.String()),
          broker_port: t.Optional(t.Number()),
          credentials: t.Optional(
            t.Object({
              username: t.Optional(t.String()),
              password: t.Optional(t.String()),
              api_key: t.Optional(t.String()),
            }),
          ),
          retry_enabled: t.Optional(t.Boolean({ default: true })),
          retry_interval_sec: t.Optional(t.Number({ default: 5 })),
          max_retries: t.Optional(t.Number({ default: 10 })),
          timeout_sec: t.Optional(t.Number({ default: 30 })),
          tls_enabled: t.Optional(t.Boolean({ default: false })),
          tls_verify: t.Optional(t.Boolean({ default: true })),
        }),
      },
    )

    .get("/adapters/:adapter_config_id/brokers", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const adapter_config_id = ctx.params.adapter_config_id;
      const brokers =
        await externalBrokerManager.getBrokerConnectionsForAdapter(
          org_id,
          adapter_config_id,
        );
      return {
        success: true,
        data: {
          adapter_config_id,
          brokers,
          total: brokers.length,
          connected: brokers.filter((b: any) => b.connection_status === "connected").length,
        },
      };
    })

    .get("/brokers", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const brokers = await externalBrokerManager.getBrokerConnectionsForOrg(org_id);
      return {
        success: true,
        data: {
          org_id,
          brokers,
          total: brokers.length,
          by_type: {
            mqtt: brokers.filter((b: any) => b.connection_type === "mqtt_broker").length,
            http: brokers.filter((b: any) => b.connection_type === "http_endpoint").length,
            error: brokers.filter((b: any) => b.connection_status === "error").length,
          },
        },
      };
    })

    .post("/brokers/:broker_id/test", async (ctx) => {
      const broker_id = ctx.params.broker_id;
      const result = await externalBrokerManager.testBrokerConnection(broker_id);
      return {
        success: result.success,
        data: result,
      };
    })

    // ============================================================
    // LNS Composite Adapter Endpoints
    // ============================================================

    .post(
      "/adapters/lns/composite",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const lns = await lnsCompositeManager.createLNSAdapter(org_id, ctx.body);
        return {
          success: true,
          data: lns,
          message: `LNS composite adapter created for vendor ${lns.lns_vendor}`,
        };
      },
      {
        body: t.Object({
          name: t.String(),
          lns_vendor: t.String(), // chirpstack, ttn, everynet
          transport_mode: t.String(), // mqtt, http, native_grpc

          // MQTT config
          mqtt_broker_url: t.Optional(t.String()),
          mqtt_app_id: t.Optional(t.String()),
          mqtt_adapter_config_id: t.Optional(t.String()),

          // HTTP config
          http_endpoint_url: t.Optional(t.String()),
          http_api_key: t.Optional(t.String()),
          http_poll_interval_ms: t.Optional(t.Number()),
          http_adapter_config_id: t.Optional(t.String()),

          // TTN native
          grpc_endpoint: t.Optional(t.String()),
          ttn_app_id: t.Optional(t.String()),
          ttn_api_key: t.Optional(t.String()),
        }),
      },
    )

    .get("/adapters/lns/composite", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const adapters = await lnsCompositeManager.getLNSAdapters(org_id);
      return {
        success: true,
        data: {
          org_id,
          adapters,
          total: adapters.length,
          by_vendor: {
            chirpstack: adapters.filter((a: any) => a.lns_vendor === "chirpstack").length,
            everynet: adapters.filter((a: any) => a.lns_vendor === "everynet").length,
            ttn: adapters.filter((a: any) => a.lns_vendor === "ttn").length,
          },
        },
      };
    })

    .get("/adapters/lns/composite/:adapter_id", async (ctx) => {
      const org_id = Number.parseInt(ctx.params.org_id);
      const adapter_id = ctx.params.adapter_id;
      const adapter = await lnsCompositeManager.getLNSAdapter(org_id, adapter_id);
      return {
        success: true,
        data: adapter,
      };
    })

    .put(
      "/adapters/lns/composite/:adapter_id",
      async (ctx) => {
        const org_id = Number.parseInt(ctx.params.org_id);
        const adapter_id = ctx.params.adapter_id;
        const updated = await lnsCompositeManager.updateLNSAdapter(
          org_id,
          adapter_id,
          ctx.body,
        );
        return {
          success: true,
          data: updated,
          message: "LNS composite adapter updated",
        };
      },
      {
        body: t.Object({
          enabled: t.Optional(t.Boolean()),
          mqtt_app_id: t.Optional(t.String()),
          http_poll_interval_ms: t.Optional(t.Number()),
        }),
      },
    );
}
