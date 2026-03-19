/**
 * Adapter Config Store - PostgreSQL Implementation
 *
 * Provides CRUD operations for:
 * - OrgAdapterConfig: organization adapter configurations
 * - AdapterInstance: running adapter instances
 */

import { randomUUID } from "crypto";
import { type Pool, QueryResult } from "pg";
import {
  AdapterHealthStatus,
  type AdapterInstance,
  AdapterStatus,
  type AdapterType,
  type AdapterVendor,
  type OrgAdapterConfig,
  type Organization,
} from "./adapter-types.ts";

export class AdapterConfigStore {
  constructor(private pool: Pool) { }

  // ===================================================================
  // Organization Management
  // ===================================================================

  async getOrganization(org_id: number): Promise<Organization | null> {
    const result = await this.pool.query(
      "SELECT id, name, created_at, settings FROM organizations WHERE id = $1",
      [org_id],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      created_at: new Date(row.created_at),
      settings: row.settings,
    };
  }

  async listOrganizations(): Promise<Organization[]> {
    const result = await this.pool.query(
      "SELECT id, name, created_at, settings FROM organizations ORDER BY name",
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      created_at: new Date(row.created_at),
      settings: row.settings,
    }));
  }

  // ===================================================================
  // Adapter Config Management
  // ===================================================================

  async saveAdapterConfig(
    org_id: number,
    adapter_type: AdapterType,
    adapter_vendor: AdapterVendor,
    name: string,
    config: Record<string, unknown>,
    enabled = true,
  ): Promise<OrgAdapterConfig> {
    const id = randomUUID();
    const now = new Date();

    const result = await this.pool.query(
      `INSERT INTO org_adapter_configs 
       (id, organization_id, adapter_type, adapter_vendor, name, enabled, config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, organization_id, adapter_type, adapter_vendor, name, enabled, config, created_at, updated_at`,
      [
        id,
        org_id,
        adapter_type,
        adapter_vendor,
        name,
        enabled,
        config,
        now,
        now,
      ],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      organization_id: row.organization_id,
      adapter_type: row.adapter_type as AdapterType,
      adapter_vendor: row.adapter_vendor as AdapterVendor,
      name: row.name,
      enabled: row.enabled,
      config: row.config,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  async getAdapterConfig(
    org_id: number,
    config_id: string,
  ): Promise<OrgAdapterConfig | null> {
    const result = await this.pool.query(
      `SELECT id, organization_id, adapter_type, adapter_vendor, name, enabled, config, created_at, updated_at
       FROM org_adapter_configs 
       WHERE id = $1 AND organization_id = $2`,
      [config_id, org_id],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      organization_id: row.organization_id,
      adapter_type: row.adapter_type as AdapterType,
      adapter_vendor: row.adapter_vendor as AdapterVendor,
      name: row.name,
      enabled: row.enabled,
      config: row.config,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  async listAdapterConfigs(
    org_id: number,
    filter?: {
      adapter_type?: AdapterType;
      adapter_vendor?: AdapterVendor;
      enabled?: boolean;
    },
  ): Promise<OrgAdapterConfig[]> {
    let query =
      "SELECT id, organization_id, adapter_type, adapter_vendor, name, enabled, config, created_at, updated_at FROM org_adapter_configs WHERE organization_id = $1";
    const params: unknown[] = [org_id];
    let paramCount = 1;

    if (filter?.adapter_type) {
      paramCount++;
      query += ` AND adapter_type = $${paramCount}`;
      params.push(filter.adapter_type);
    }

    if (filter?.adapter_vendor) {
      paramCount++;
      query += ` AND adapter_vendor = $${paramCount}`;
      params.push(filter.adapter_vendor);
    }

    if (filter?.enabled !== undefined) {
      paramCount++;
      query += ` AND enabled = $${paramCount}`;
      params.push(filter.enabled);
    }

    query += " ORDER BY created_at DESC";

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      adapter_type: row.adapter_type as AdapterType,
      adapter_vendor: row.adapter_vendor as AdapterVendor,
      name: row.name,
      enabled: row.enabled,
      config: row.config,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  }

  async updateAdapterConfig(
    org_id: number,
    config_id: string,
    updates: {
      name?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    },
  ): Promise<OrgAdapterConfig | null> {
    const now = new Date();
    const setClauses: string[] = ["updated_at = $1"];
    const params: unknown[] = [now];
    let paramCount = 1;

    if (updates.name !== undefined) {
      paramCount++;
      setClauses.push(`name = $${paramCount}`);
      params.push(updates.name);
    }

    if (updates.enabled !== undefined) {
      paramCount++;
      setClauses.push(`enabled = $${paramCount}`);
      params.push(updates.enabled);
    }

    if (updates.config !== undefined) {
      paramCount++;
      setClauses.push(`config = $${paramCount}`);
      params.push(updates.config);
    }

    paramCount++;
    params.push(config_id);
    paramCount++;
    params.push(org_id);

    const result = await this.pool.query(
      `UPDATE org_adapter_configs 
       SET ${setClauses.join(", ")}
       WHERE id = $${paramCount - 1} AND organization_id = $${paramCount}
       RETURNING id, organization_id, adapter_type, adapter_vendor, name, enabled, config, created_at, updated_at`,
      params,
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      organization_id: row.organization_id,
      adapter_type: row.adapter_type as AdapterType,
      adapter_vendor: row.adapter_vendor as AdapterVendor,
      name: row.name,
      enabled: row.enabled,
      config: row.config,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  async deleteAdapterConfig(
    org_id: number,
    config_id: string,
  ): Promise<boolean> {
    // First, delete all instances for this config
    await this.pool.query(
      "DELETE FROM adapter_instances WHERE config_id = $1 AND organization_id = $2",
      [config_id, org_id],
    );

    // Then delete the config
    const result = await this.pool.query(
      "DELETE FROM org_adapter_configs WHERE id = $1 AND organization_id = $2",
      [config_id, org_id],
    );

    return result.rowCount > 0;
  }

  // ===================================================================
  // Adapter Instance Management
  // ===================================================================

  async saveAdapterInstance(
    config_id: string,
    org_id: number,
    status: AdapterStatus = AdapterStatus.STARTING,
  ): Promise<AdapterInstance> {
    const id = randomUUID();

    const result = await this.pool.query(
      `INSERT INTO adapter_instances 
       (id, config_id, organization_id, status, events_processed, health_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, config_id, organization_id, status, started_at, stopped_at, events_processed, last_error, health_status, last_health_check`,
      [id, config_id, org_id, status, 0, AdapterHealthStatus.UNKNOWN],
    );

    const row = result.rows[0];
    return this.rowToAdapterInstance(row);
  }

  async getAdapterInstance(
    org_id: number,
    config_id: string,
  ): Promise<AdapterInstance | null> {
    const result = await this.pool.query(
      `SELECT id, config_id, organization_id, status, started_at, stopped_at, events_processed, last_error, health_status, last_health_check
       FROM adapter_instances 
       WHERE config_id = $1 AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [config_id, org_id],
    );

    if (result.rows.length === 0) return null;

    return this.rowToAdapterInstance(result.rows[0]);
  }

  async listAdapterInstances(
    org_id: number,
    config_id?: string,
  ): Promise<AdapterInstance[]> {
    let query =
      "SELECT id, config_id, organization_id, status, started_at, stopped_at, events_processed, last_error, health_status, last_health_check FROM adapter_instances WHERE organization_id = $1";
    const params: unknown[] = [org_id];

    if (config_id) {
      query += " AND config_id = $2";
      params.push(config_id);
    }

    query += " ORDER BY created_at DESC";

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => this.rowToAdapterInstance(row));
  }

  async updateAdapterInstance(
    org_id: number,
    config_id: string,
    updates: {
      status?: AdapterStatus;
      started_at?: Date;
      stopped_at?: Date;
      events_processed?: number;
      last_error?: string | null;
      health_status?: AdapterHealthStatus;
      last_health_check?: Date;
    },
  ): Promise<AdapterInstance | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramCount = 0;

    if (updates.status !== undefined) {
      paramCount++;
      setClauses.push(`status = $${paramCount}`);
      params.push(updates.status);
    }

    if (updates.started_at !== undefined) {
      paramCount++;
      setClauses.push(`started_at = $${paramCount}`);
      params.push(updates.started_at);
    }

    if (updates.stopped_at !== undefined) {
      paramCount++;
      setClauses.push(`stopped_at = $${paramCount}`);
      params.push(updates.stopped_at);
    }

    if (updates.events_processed !== undefined) {
      paramCount++;
      setClauses.push(`events_processed = $${paramCount}`);
      params.push(updates.events_processed);
    }

    if (updates.last_error !== undefined) {
      paramCount++;
      setClauses.push(`last_error = $${paramCount}`);
      params.push(updates.last_error);
    }

    if (updates.health_status !== undefined) {
      paramCount++;
      setClauses.push(`health_status = $${paramCount}`);
      params.push(updates.health_status);
    }

    if (updates.last_health_check !== undefined) {
      paramCount++;
      setClauses.push(`last_health_check = $${paramCount}`);
      params.push(updates.last_health_check);
    }

    if (setClauses.length === 0) return null;

    paramCount++;
    params.push(config_id);
    paramCount++;
    params.push(org_id);

    const result = await this.pool.query(
      `UPDATE adapter_instances 
       SET ${setClauses.join(", ")}
       WHERE config_id = $${paramCount - 1} AND organization_id = $${paramCount}
       ORDER BY created_at DESC
       LIMIT 1
       RETURNING id, config_id, organization_id, status, started_at, stopped_at, events_processed, last_error, health_status, last_health_check`,
      params,
    );

    if (result.rows.length === 0) return null;

    return this.rowToAdapterInstance(result.rows[0]);
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  private rowToAdapterInstance(row: any): AdapterInstance {
    return {
      id: row.id,
      config_id: row.config_id,
      organization_id: row.organization_id,
      status: row.status as AdapterStatus,
      started_at: row.started_at ? new Date(row.started_at) : undefined,
      stopped_at: row.stopped_at ? new Date(row.stopped_at) : undefined,
      events_processed: Number(row.events_processed),
      last_error: row.last_error,
      health_status: row.health_status as AdapterHealthStatus,
      last_health_check: row.last_health_check
        ? new Date(row.last_health_check)
        : undefined,
    };
  }
}

