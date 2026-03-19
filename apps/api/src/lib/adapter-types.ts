/**
 * Adapter Manager Types
 * 
 * Defines the data models for the multi-tenant, multi-vendor adapter system
 * Organization → AdapterType → AdapterVendor → AdapterInstance
 */

// ============================================================
// Adapter Type Enumeration
// ============================================================

export enum AdapterType {
  MQTT = "mqtt",
  LNS = "lns",
  HTTP = "http",
  AGENT = "agent",
  ZC2X = "zc2x",
  CUSTOM = "custom",
}

export enum AdapterVendor {
  // MQTT Vendors
  MOSQUITTO = "mosquitto",
  ACTIVEMQ = "activemq",
  RABBITMQ = "rabbitmq",

  // LNS Vendors
  CHIRPSTACK = "chirpstack",
  TTN = "ttn",
  DRAGINO = "dragino",

  // HTTP Vendors
  HTTP_WEBHOOK = "http-webhook",
  HTTP_POLLER = "http-poller",

  // Agent Vendors
  AGENT_CLI = "agent-cli",
  AGENT_SSH = "agent-ssh",

  // ZC2X Vendors
  ZC2X_DIRECT = "zc2x-direct",
  ZC2X_COORDINATOR = "zc2x-coordinator",

  // Custom
  CUSTOM = "custom",
}

// ============================================================
// Adapter Status & Health
// ============================================================

export enum AdapterStatus {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  STOPPING = "stopping",
  ERROR = "error",
}

export enum AdapterHealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
  UNKNOWN = "unknown",
}

// ============================================================
// Database Models
// ============================================================

export interface Organization {
  id: number;
  name: string;
  created_at: Date;
  settings?: Record<string, unknown>;
}

export interface OrgAdapterConfig {
  id: string; // UUID
  organization_id: number;
  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>; // Vendor-specific config
  created_at: Date;
  updated_at: Date;
}

export interface AdapterInstance {
  id: string; // UUID
  config_id: string; // Reference to OrgAdapterConfig
  organization_id: number;
  status: AdapterStatus;
  started_at?: Date;
  stopped_at?: Date;
  events_processed: number;
  last_error?: string;
  health_status: AdapterHealthStatus;
  last_health_check?: Date;
}

export interface AdapterHealth {
  status: AdapterHealthStatus;
  message?: string;
  last_check?: Date;
  events_processed: number;
  error_count: number;
  connection_status?: string;
  uptime_seconds?: number;
}

// ============================================================
// Vendor Configuration Schemas
// ============================================================

export interface VendorSchema {
  type: AdapterType;
  vendor: AdapterVendor;
  properties: Record<string, unknown>;
  required: string[];
  description?: string;
}

export interface MQTTMosquittoConfig {
  broker: string; // mqtt://host:port
  topics?: string[];
  qos?: 0 | 1 | 2;
  username?: string;
  password?: string;
  client_id?: string;
  keep_alive?: number;
}

export interface MQTTActiveMQConfig {
  broker: string; // tcp://host:61616
  username?: string;
  password?: string;
  client_id?: string;
  topics?: string[];
}

export interface MQTTRabbitMQConfig {
  broker: string; // amqp://host:5672
  username?: string;
  password?: string;
  vhost?: string;
  queue?: string;
}

export interface LNSChirpstackConfig {
  api_url: string; // https://chirpstack.example.com
  api_token: string; // Bearer token (encrypted in DB)
  region: string; // EU868, US915, etc.
  organization_id?: string;
}

export interface LNSTTNConfig {
  api_url: string; // https://eu1.cloud.thethings.network
  api_key: string; // (encrypted in DB)
  app_id: string;
  region?: string;
}

export interface LNSDraguinoConfig {
  api_url: string;
  api_key: string; // (encrypted in DB)
  device_id?: string;
}

export interface HTTPWebhookConfig {
  endpoint_path: string; // /webhook/mqtt
  port?: number;
  auth_token?: string;
}

export interface HTTPPollerConfig {
  poll_url: string;
  poll_interval_ms?: number;
  auth_token?: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}

export interface AgentCLIConfig {
  port: number;
  host?: string;
  auth_token?: string;
}

export interface ZC2XDirectConfig {
  port: string; // /dev/ttyUSB0
  baudrate?: number;
  channel?: number;
  pan_id?: string;
}

// ============================================================
// API Request/Response Types
// ============================================================

export interface CreateAdapterConfigRequest {
  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;
  name: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateAdapterConfigRequest {
  name?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface AdapterConfigResponse extends OrgAdapterConfig {
  instance?: AdapterInstanceResponse;
}

export interface AdapterInstanceResponse extends AdapterInstance {
  config?: OrgAdapterConfig;
  health?: AdapterHealth;
}

export interface AdapterListResponse {
  id: string;
  adapter_type: AdapterType;
  adapter_vendor: AdapterVendor;
  name: string;
  status: AdapterStatus;
  health_status: AdapterHealthStatus;
  events_processed: number;
  enabled: boolean;
}

// ============================================================
// Service Layer Types
// ============================================================

export interface AdapterManagerService {
  // Config Management
  createAdapter(
    org_id: number,
    req: CreateAdapterConfigRequest,
  ): Promise<OrgAdapterConfig>;

  updateAdapter(
    org_id: number,
    config_id: string,
    req: UpdateAdapterConfigRequest,
  ): Promise<OrgAdapterConfig>;

  deleteAdapter(org_id: number, config_id: string): Promise<void>;

  getAdapter(org_id: number, config_id: string): Promise<OrgAdapterConfig>;

  listAdapters(
    org_id: number,
    filter?: {
      adapter_type?: AdapterType;
      adapter_vendor?: AdapterVendor;
      enabled?: boolean;
    },
  ): Promise<OrgAdapterConfig[]>;

  // Lifecycle management
  startAdapter(org_id: number, config_id: string): Promise<AdapterInstance>;
  stopAdapter(org_id: number, config_id: string): Promise<void>;
  restartAdapter(org_id: number, config_id: string): Promise<AdapterInstance>;

  // Health monitoring
  getAdapterHealth(org_id: number, config_id: string): Promise<AdapterHealth>;

  // Vendor management
  getSupportedTypes(): AdapterType[];
  getSupportedVendors(type: AdapterType): AdapterVendor[];
  getVendorSchema(type: AdapterType, vendor: AdapterVendor): VendorSchema;
}

// ============================================================
// Utilities
// ============================================================

export const ADAPTER_TYPE_VENDORS: Record<AdapterType, AdapterVendor[]> = {
  [AdapterType.MQTT]: [
    AdapterVendor.MOSQUITTO,
    AdapterVendor.ACTIVEMQ,
    AdapterVendor.RABBITMQ,
  ],
  [AdapterType.LNS]: [
    AdapterVendor.CHIRPSTACK,
    AdapterVendor.TTN,
    AdapterVendor.DRAGINO,
  ],
  [AdapterType.HTTP]: [AdapterVendor.HTTP_WEBHOOK, AdapterVendor.HTTP_POLLER],
  [AdapterType.AGENT]: [AdapterVendor.AGENT_CLI, AdapterVendor.AGENT_SSH],
  [AdapterType.ZC2X]: [
    AdapterVendor.ZC2X_DIRECT,
    AdapterVendor.ZC2X_COORDINATOR,
  ],
  [AdapterType.CUSTOM]: [AdapterVendor.CUSTOM],
};

export function getVendorsForType(type: AdapterType): AdapterVendor[] {
  return ADAPTER_TYPE_VENDORS[type] || [];
}

export function isValidVendorForType(
  type: AdapterType,
  vendor: AdapterVendor,
): boolean {
  return getVendorsForType(type).includes(vendor);
}
