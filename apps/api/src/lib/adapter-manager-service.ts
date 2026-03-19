/**
 * Adapter Manager Service
 *
 * Orchestrates adapter lifecycle management:
 * - Configuration: create, read, update, delete
 * - Instances: start, stop, monitor
 * - Vendors: schema management, validation
 */

import type { AdapterConfigStore } from "./adapter-config-store.ts";
import {
  ADAPTER_TYPE_VENDORS,
  type AdapterHealth,
  AdapterHealthStatus,
  type AdapterInstance,
  AdapterStatus,
  AdapterType,
  type AdapterVendor,
  type CreateAdapterConfigRequest,
  isValidVendorForType,
  type OrgAdapterConfig,
  type UpdateAdapterConfigRequest,
} from "./adapter-types.ts";
import {
  getAllSchemasByType,
  getAllVendorSchemas,
  getVendorSchema,
} from "./vendor-schemas.ts";

export class AdapterManagerService {
  constructor(private store: AdapterConfigStore) { }

  // ===================================================================
  // Adapter Configuration Management
  // ===================================================================

  async createAdapter(
    org_id: number,
    req: CreateAdapterConfigRequest,
  ): Promise<OrgAdapterConfig> {
    // Validate organization exists
    const org = await this.store.getOrganization(org_id);
    if (!org) {
      throw new Error(`Organization ${org_id} not found`);
    }

    // Validate adapter type
    if (!Object.values(AdapterType).includes(req.adapter_type)) {
      throw new Error(`Invalid adapter type: ${req.adapter_type}`);
    }

    // Validate vendor for type
    if (!isValidVendorForType(req.adapter_type, req.adapter_vendor)) {
      throw new Error(
        `${req.adapter_vendor} is not a valid vendor for ${req.adapter_type}`,
      );
    }

    // Validate config against schema
    const schema = getVendorSchema(req.adapter_type, req.adapter_vendor);
    if (schema) {
      this.validateConfigAgainstSchema(req.config, schema);
    }

    // Create and save
    return this.store.saveAdapterConfig(
      org_id,
      req.adapter_type,
      req.adapter_vendor,
      req.name,
      req.config,
      req.enabled ?? true,
    );
  }

  async updateAdapter(
    org_id: number,
    config_id: string,
    req: UpdateAdapterConfigRequest,
  ): Promise<OrgAdapterConfig> {
    // Check if config exists
    const existing = await this.store.getAdapterConfig(org_id, config_id);
    if (!existing) {
      throw new Error(
        `Adapter config ${config_id} not found for org ${org_id}`,
      );
    }

    // Validate updated config if provided
    if (req.config) {
      const schema = getVendorSchema(
        existing.adapter_type,
        existing.adapter_vendor,
      );
      if (schema) {
        this.validateConfigAgainstSchema(req.config, schema);
      }
    }

    // Update in database
    const updated = await this.store.updateAdapterConfig(
      org_id,
      config_id,
      req,
    );

    if (!updated) {
      throw new Error("Failed to update adapter config");
    }

    return updated;
  }

  async deleteAdapter(org_id: number, config_id: string): Promise<void> {
    // Check if adapter is running and stop it first
    const instance = await this.store.getAdapterInstance(org_id, config_id);
    if (
      instance &&
      instance.status !== AdapterStatus.STOPPED &&
      instance.status !== AdapterStatus.ERROR
    ) {
      throw new Error(
        "Cannot delete adapter while it is running. Stop it first.",
      );
    }

    const deleted = await this.store.deleteAdapterConfig(org_id, config_id);

    if (!deleted) {
      throw new Error(`Failed to delete adapter config ${config_id}`);
    }
  }

  async getAdapter(
    org_id: number,
    config_id: string,
  ): Promise<OrgAdapterConfig> {
    const config = await this.store.getAdapterConfig(org_id, config_id);
    if (!config) {
      throw new Error(`Adapter config ${config_id} not found`);
    }
    return config;
  }

  async listAdapters(
    org_id: number,
    filter?: {
      adapter_type?: AdapterType;
      adapter_vendor?: AdapterVendor;
      enabled?: boolean;
    },
  ): Promise<OrgAdapterConfig[]> {
    return this.store.listAdapterConfigs(org_id, filter);
  }

  // ===================================================================
  // Adapter Lifecycle Management
  // ===================================================================

  async startAdapter(
    org_id: number,
    config_id: string,
  ): Promise<AdapterInstance> {
    // Check if config exists and is enabled
    const config = await this.store.getAdapterConfig(org_id, config_id);
    if (!config) {
      throw new Error(`Adapter config ${config_id} not found`);
    }

    if (!config.enabled) {
      throw new Error(
        `Adapter is disabled. Enable it first in the configuration.`,
      );
    }

    // Check if already running
    const existing = await this.store.getAdapterInstance(org_id, config_id);
    if (
      existing &&
      existing.status !== AdapterStatus.STOPPED &&
      existing.status !== AdapterStatus.ERROR
    ) {
      return existing;
    }

    // Create new instance
    const instance = await this.store.saveAdapterInstance(
      config_id,
      org_id,
      AdapterStatus.STARTING,
    );

    // TODO: Call actual adapter factory to start the adapter
    // For now, just mark as running
    return (
      this.store.updateAdapterInstance(org_id, config_id, {
        status: AdapterStatus.RUNNING,
        started_at: new Date(),
        health_status: AdapterHealthStatus.HEALTHY,
        last_health_check: new Date(),
      }) || instance
    );
  }

  async stopAdapter(org_id: number, config_id: string): Promise<void> {
    // Check if config exists
    const config = await this.store.getAdapterConfig(org_id, config_id);
    if (!config) {
      throw new Error(`Adapter config ${config_id} not found`);
    }

    // Get current instance
    const instance = await this.store.getAdapterInstance(org_id, config_id);
    if (!instance) {
      return;
    }

    // TODO: Call actual adapter factory to stop the adapter

    // Mark as stopped
    await this.store.updateAdapterInstance(org_id, config_id, {
      status: AdapterStatus.STOPPED,
      stopped_at: new Date(),
      health_status: AdapterHealthStatus.UNHEALTHY,
      last_health_check: new Date(),
    });
  }

  async restartAdapter(
    org_id: number,
    config_id: string,
  ): Promise<AdapterInstance> {
    await this.stopAdapter(org_id, config_id);
    // Small delay to allow clean shutdown
    await new Promise((resolve) => setTimeout(resolve, 100));
    return this.startAdapter(org_id, config_id);
  }

  // ===================================================================
  // Health Monitoring
  // ===================================================================

  async getAdapterHealth(
    org_id: number,
    config_id: string,
  ): Promise<AdapterHealth> {
    const instance = await this.store.getAdapterInstance(org_id, config_id);
    if (!instance) {
      return {
        status: AdapterHealthStatus.UNKNOWN,
        message: "No instance found",
        events_processed: 0,
        error_count: 0,
      };
    }

    let uptime_seconds;
    if (instance.started_at) {
      uptime_seconds = Math.floor(
        (Date.now() - instance.started_at.getTime()) / 1000,
      );
    }

    return {
      status: instance.health_status,
      message: instance.last_error || undefined,
      last_check: instance.last_health_check,
      events_processed: instance.events_processed,
      error_count: instance.last_error ? 1 : 0,
      uptime_seconds,
    };
  }

  // ===================================================================
  // Vendor & Schema Management
  // ===================================================================

  getSupportedTypes(): AdapterType[] {
    return Object.values(AdapterType);
  }

  getSupportedVendors(type: AdapterType): AdapterVendor[] {
    return ADAPTER_TYPE_VENDORS[type] || [];
  }

  getVendorSchema(type: AdapterType, vendor: AdapterVendor) {
    const schema = getVendorSchema(type, vendor);
    if (!schema) {
      throw new Error(`Schema not found for ${type}/${vendor}`);
    }
    return schema;
  }

  getAllSchemas(type?: AdapterType) {
    if (type) {
      return getAllSchemasByType(type);
    }
    return getAllVendorSchemas();
  }

  // ===================================================================
  // Validation
  // ===================================================================

  private validateConfigAgainstSchema(
    config: Record<string, unknown>,
    schema: any,
  ): void {
    // Basic validation: check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in config)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
    }

    // Validate field types and patterns based on schema
    if (schema.properties) {
      for (const [key, value] of Object.entries(config)) {
        if (!schema.properties[key]) {
          // Unknown property (not strictly an error, just warning)
          continue;
        }

        const fieldSchema = schema.properties[key] as any;

        // Type validation
        if (fieldSchema.type) {
          const valueType = typeof value;
          if (fieldSchema.type === "array" && !Array.isArray(value)) {
            throw new Error(`${key} must be an array`);
          }
          if (
            fieldSchema.type === "object" &&
            (valueType !== "object" || Array.isArray(value))
          ) {
            throw new Error(`${key} must be an object`);
          }
          if (fieldSchema.type === "string" && valueType !== "string") {
            throw new Error(`${key} must be a string`);
          }
          if (fieldSchema.type === "integer" && !Number.isInteger(value)) {
            throw new Error(`${key} must be an integer`);
          }
          if (fieldSchema.type === "number" && typeof value !== "number") {
            throw new Error(`${key} must be a number`);
          }
          if (fieldSchema.type === "boolean" && typeof value !== "boolean") {
            throw new Error(`${key} must be a boolean`);
          }
        }

        // Enum validation
        if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
          throw new Error(
            `${key} value must be one of: ${(fieldSchema.enum as unknown[]).join(", ")}`,
          );
        }

        // Pattern validation
        if (fieldSchema.pattern && typeof value === "string") {
          const regex = new RegExp(fieldSchema.pattern);
          if (!regex.test(value)) {
            throw new Error(
              `${key} does not match required pattern: ${fieldSchema.pattern}`,
            );
          }
        }

        // Min/Max validation
        if (
          fieldSchema.minimum &&
          typeof value === "number" &&
          value < fieldSchema.minimum
        ) {
          throw new Error(`${key} must be >= ${fieldSchema.minimum}`);
        }
        if (
          fieldSchema.maximum &&
          typeof value === "number" &&
          value > fieldSchema.maximum
        ) {
          throw new Error(`${key} must be <= ${fieldSchema.maximum}`);
        }
      }
    }
  }
}

