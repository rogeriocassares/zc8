/**
 * Device Routing Configuration
 *
 * Maps devices to specific integrations based on:
 * - Device model / device class
 * - Vendor
 * - Parsed field values
 *
 * Example: Device model "chirpstack-lora" → LNS adapter
 *          Device model "mqtt-sensor" → MQTT broker A or B
 *          Device model "http-poller" → HTTP endpoint C
 */

import type { AdapterType, AdapterVendor } from "./adapter-types.ts";

export interface DeviceRouteRule {
  id: string;
  organization_id: number;
  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;
  adapter_config_id?: string; // Reference to specific config if multiple

  // Matching criteria (all must match)
  device_model?: string; // "chirpstack-lora", "mqtt-sensor"
  device_class?: string; // "lora", "zigbee", "mqtt"
  vendor_name?: string; // "dragino", "sensirion"

  // Target adapter/broker/endpoint
  target_broker_url?: string; // For MQTT: "tcp://broker1:1883"
  target_endpoint_url?: string; // For HTTP: "https://api.example.com"
  target_gw_id?: string; // For Agent/ZC2X: "agent-gw-1"

  // Priority / Load balancing
  priority: number; // 0-100, higher = preferred
  weight?: number; // For weighted load balancing

  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DeviceRoutingResult {
  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;
  adapter_config_id?: string;
  broker_url?: string;
  endpoint_url?: string;
  gw_id?: string;
  routing_rule_id: string;
  priority: number;
}

export class DeviceRouter {
  constructor(private routingRules: DeviceRouteRule[]) { }

  /**
   * Find the best matching route for a device
   * Returns highest-priority matching rule
   */
  resolveRoute(
    organizationId: number,
    deviceModel: string,
    deviceClass?: string,
    vendorName?: string,
  ): DeviceRoutingResult | null {
    // Filter rules for this org
    const orgRules = this.routingRules.filter(
      (r) =>
        r.organization_id === organizationId &&
        r.enabled &&
        this.rulesMatch(r, deviceModel, deviceClass, vendorName),
    );

    if (orgRules.length === 0) return null;

    // Sort by priority descending, take first
    const bestRule = orgRules.sort((a, b) => b.priority - a.priority)[0];

    return {
      adapter_type: bestRule.adapter_type,
      adapter_vendor: bestRule.adapter_vendor,
      adapter_config_id: bestRule.adapter_config_id,
      broker_url: bestRule.target_broker_url,
      endpoint_url: bestRule.target_endpoint_url,
      gw_id: bestRule.target_gw_id,
      routing_rule_id: bestRule.id,
      priority: bestRule.priority,
    };
  }

  /**
   * Find multiple matching routes (for weighted load balancing)
   */
  resolveRoutes(
    organizationId: number,
    deviceModel: string,
    deviceClass?: string,
    vendorName?: string,
  ): DeviceRoutingResult[] {
    const orgRules = this.routingRules.filter(
      (r) =>
        r.organization_id === organizationId &&
        r.enabled &&
        this.rulesMatch(r, deviceModel, deviceClass, vendorName),
    );

    return orgRules
      .sort((a, b) => b.priority - a.priority)
      .map((rule) => ({
        adapter_type: rule.adapter_type,
        adapter_vendor: rule.adapter_vendor,
        adapter_config_id: rule.adapter_config_id,
        broker_url: rule.target_broker_url,
        endpoint_url: rule.target_endpoint_url,
        gw_id: rule.target_gw_id,
        routing_rule_id: rule.id,
        priority: rule.priority,
      }));
  }

  private rulesMatch(
    rule: DeviceRouteRule,
    deviceModel: string,
    deviceClass?: string,
    vendorName?: string,
  ): boolean {
    // All specified criteria must match
    if (rule.device_model && rule.device_model !== deviceModel) {
      return false;
    }
    if (
      rule.device_class &&
      deviceClass &&
      rule.device_class !== deviceClass
    ) {
      return false;
    }
    if (
      rule.vendor_name &&
      vendorName &&
      rule.vendor_name !== vendorName
    ) {
      return false;
    }
    return true;
  }
}

export interface DeviceRoutingRuleRequest {
  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;
  adapter_config_id?: string;
  device_model?: string;
  device_class?: string;
  vendor_name?: string;
  target_broker_url?: string;
  target_endpoint_url?: string;
  target_gw_id?: string;
  priority: number;
}

export class DeviceRoutingManager {
  constructor(private store: any) { } // Would be AdapterConfigStore

  async createRule(
    org_id: number,
    req: DeviceRoutingRuleRequest,
  ): Promise<DeviceRouteRule> {
    // In real implementation, save to database
    const rule: DeviceRouteRule = {
      id: crypto.randomUUID(),
      organization_id: org_id,
      adapter_type: req.adapter_type,
      adapter_vendor: req.adapter_vendor,
      adapter_config_id: req.adapter_config_id,
      device_model: req.device_model,
      device_class: req.device_class,
      vendor_name: req.vendor_name,
      target_broker_url: req.target_broker_url,
      target_endpoint_url: req.target_endpoint_url,
      target_gw_id: req.target_gw_id,
      priority: req.priority,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    return rule;
  }

  async getRulesForOrg(org_id: number): Promise<DeviceRouteRule[]> {
    // Would query from database
    return [];
  }
}
