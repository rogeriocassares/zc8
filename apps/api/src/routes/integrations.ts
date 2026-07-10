/**
 * Integration Registry API Routes
 *
 * Provides CRUD for the unified integration layer:
 *   GET  /api/v1/integration-providers     — list all codec/parser providers
 *   GET  /api/v1/integrations              — list all integration entries
 *   POST /api/v1/integrations              — create integration + type config
 *   GET  /api/v1/integrations/:id          — get single integration with config
 *   PUT  /api/v1/integrations/:id          — update integration and/or config
 *   DELETE /api/v1/integrations/:id        — delete (cascades to config)
 *   POST /api/v1/integrations/:id/test     — test connectivity
 */

import { and, asc, eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import {
  integrationConfigClickhouse,
  integrationConfigGrpc,
  integrationConfigHttp,
  integrationConfigInfluxdb3,
  integrationConfigMqtt,
  integrationProvider,
  integrationRegistry,
  organizations,
  teams,
} from "../db/schema";

type IntegrationType =
  | "grpc-server"
  | "grpc-client"
  | "http-server"
  | "http-client"
  | "mqtt"
  | "influxdb3"
  | "clickhouse";

type Direction = "input" | "output";

const INPUT_TYPES: IntegrationType[] = ["grpc-server", "http-server"];
const OUTPUT_TYPES: IntegrationType[] = ["grpc-client", "http-client", "influxdb3", "clickhouse"];

/** Returns the inferred direction for unambiguous types; undefined for 'mqtt'. */
function directionForType(type: IntegrationType): Direction | undefined {
  if (INPUT_TYPES.includes(type)) return "input";
  if (OUTPUT_TYPES.includes(type)) return "output";
  return undefined; // mqtt: direction must come from the request body
}

/** Fetch the type-specific config row for an integration */
async function fetchConfig(
  db: DrizzleDB,
  type: IntegrationType,
  integrationId: number,
) {
  switch (type) {
    case "grpc-server":
    case "grpc-client":
      return (
        (
          await db
            .select()
            .from(integrationConfigGrpc)
            .where(eq(integrationConfigGrpc.integrationId, integrationId))
            .limit(1)
        )[0] ?? null
      );
    case "http-server":
    case "http-client":
      return (
        (
          await db
            .select()
            .from(integrationConfigHttp)
            .where(eq(integrationConfigHttp.integrationId, integrationId))
            .limit(1)
        )[0] ?? null
      );
    case "mqtt":
      return (
        (
          await db
            .select()
            .from(integrationConfigMqtt)
            .where(eq(integrationConfigMqtt.integrationId, integrationId))
            .limit(1)
        )[0] ?? null
      );
    case "influxdb3":
      return (
        (
          await db
            .select()
            .from(integrationConfigInfluxdb3)
            .where(eq(integrationConfigInfluxdb3.integrationId, integrationId))
            .limit(1)
        )[0] ?? null
      );
    case "clickhouse":
      return (
        (
          await db
            .select()
            .from(integrationConfigClickhouse)
            .where(eq(integrationConfigClickhouse.integrationId, integrationId))
            .limit(1)
        )[0] ?? null
      );
    default:
      return null;
  }
}

/** Insert a type-specific config row */
async function insertConfig(
  db: DrizzleDB,
  type: IntegrationType,
  integrationId: number,
  cfg: Record<string, unknown>,
  direction?: Direction,
) {
  switch (type) {
    case "grpc-server":
      return (
        await db
          .insert(integrationConfigGrpc)
          .values({ integrationId, ...grpcServerDefaults(cfg) })
          .returning()
      )[0];
    case "grpc-client":
      return (
        await db
          .insert(integrationConfigGrpc)
          .values({ integrationId, ...grpcClientDefaults(cfg) })
          .returning()
      )[0];
    case "http-server":
      return (
        await db
          .insert(integrationConfigHttp)
          .values({ integrationId, ...httpServerDefaults(cfg) })
          .returning()
      )[0];
    case "http-client":
      return (
        await db
          .insert(integrationConfigHttp)
          .values({ integrationId, ...httpClientDefaults(cfg) })
          .returning()
      )[0];
    case "mqtt":
      return direction === "output"
        ? (
          await db
            .insert(integrationConfigMqtt)
            .values({ integrationId, ...mqttOutputDefaults(cfg) })
            .returning()
        )[0]
        : (
          await db
            .insert(integrationConfigMqtt)
            .values({ integrationId, ...mqttInputDefaults(cfg) })
            .returning()
        )[0];
    case "influxdb3":
      return (
        await db
          .insert(integrationConfigInfluxdb3)
          .values({ integrationId, ...influxdb3Defaults(cfg) })
          .returning()
      )[0];
    case "clickhouse":
      return (
        await db
          .insert(integrationConfigClickhouse)
          .values({ integrationId, ...clickhouseDefaults(cfg) })
          .returning()
      )[0];
  }
}

/** Patch a type-specific config row */
async function patchConfig(
  db: DrizzleDB,
  type: IntegrationType,
  integrationId: number,
  cfg: Record<string, unknown>,
) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  switch (type) {
    case "grpc-server":
      Object.assign(updates, grpcServerPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigGrpc)
          .set(updates)
          .where(eq(integrationConfigGrpc.integrationId, integrationId));
      break;
    case "grpc-client":
      Object.assign(updates, grpcClientPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigGrpc)
          .set(updates)
          .where(eq(integrationConfigGrpc.integrationId, integrationId));
      break;
    case "http-server":
      Object.assign(updates, httpServerPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigHttp)
          .set(updates)
          .where(eq(integrationConfigHttp.integrationId, integrationId));
      break;
    case "http-client":
      Object.assign(updates, httpClientPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigHttp)
          .set(updates)
          .where(eq(integrationConfigHttp.integrationId, integrationId));
      break;
    case "mqtt":
      Object.assign(updates, mqttPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigMqtt)
          .set(updates)
          .where(eq(integrationConfigMqtt.integrationId, integrationId));
      break;
    case "influxdb3":
      Object.assign(updates, influxdb3Patch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigInfluxdb3)
          .set(updates)
          .where(eq(integrationConfigInfluxdb3.integrationId, integrationId));
      break;
    case "clickhouse":
      Object.assign(updates, clickhousePatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(integrationConfigClickhouse)
          .set(updates)
          .where(eq(integrationConfigClickhouse.integrationId, integrationId));
      break;
  }
}

// ── Config value helpers ─────────────────────────────────────────────────────

function grpcServerDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string) ?? "0.0.0.0",
    port: (c.port as number) ?? 50051,
    serviceName: (c.service_name as string) ?? "",
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? null,
    maxConnectionAgeSec: (c.max_connection_age_sec as number) ?? null,
  };
}
function grpcServerPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.service_name !== undefined) p.serviceName = c.service_name;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  if (c.max_connection_age_sec !== undefined)
    p.maxConnectionAgeSec = c.max_connection_age_sec;
  return p;
}

function httpServerDefaults(c: Record<string, unknown>) {
  return {
    listenPath: (c.listen_path as string) ?? "/ingest",
    authType: (c.auth_type as string) ?? "none",
    authCredentials: (c.auth_credentials as string) ?? (c.auth_secret as string) ?? null,
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? null,
  };
}
function httpServerPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.listen_path !== undefined) p.listenPath = c.listen_path;
  if (c.auth_type !== undefined) p.authType = c.auth_type;
  if (c.auth_credentials !== undefined) p.authCredentials = c.auth_credentials;
  else if (c.auth_secret !== undefined) p.authCredentials = c.auth_secret;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  return p;
}

/** MQTT defaults for input (subscribe) direction */
/** Parse a topics value that may be a JS array or a JSON-stringified array string. */
function parseTopics(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try { return JSON.parse(v) as string[]; } catch { /* fall through */ }
  }
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function mqttInputDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string)!,
    port: (c.port as number) ?? 1883,
    username: (c.username as string) ?? null,
    password: (c.password as string) ?? null,
    qos: (c.qos as number) ?? 1,
    cleanSession: (c.clean_session as boolean) ?? false,
    keepAliveSec: (c.keep_alive_sec as number) ?? 60,
    connectionTimeoutSec: (c.connection_timeout_sec as number) ?? 10,
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsClientCert: (c.tls_client_cert as string) ?? null,
    tlsClientKey: (c.tls_client_key as string) ?? null,
    tlsSkipVerify: (c.tls_skip_verify as boolean) ?? false,
    subscribeTopics: parseTopics(c.subscribe_topics ?? c.topics),
    publishTopicTemplate: null,
    maxReconnectIntervalSec: (c.max_reconnect_interval_sec as number) ?? 10,
  };
}

/** MQTT defaults for output (publish) direction */
function mqttOutputDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string)!,
    port: (c.port as number) ?? 1883,
    username: (c.username as string) ?? null,
    password: (c.password as string) ?? null,
    qos: (c.qos as number) ?? 1,
    cleanSession: (c.clean_session as boolean) ?? false,
    keepAliveSec: (c.keep_alive_sec as number) ?? 60,
    connectionTimeoutSec: (c.connection_timeout_sec as number) ?? 10,
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsClientCert: (c.tls_client_cert as string) ?? null,
    tlsClientKey: (c.tls_client_key as string) ?? null,
    tlsSkipVerify: (c.tls_skip_verify as boolean) ?? false,
    subscribeTopics: [],
    publishTopicTemplate: (c.publish_topic_template as string) ?? (c.topic_template as string) ?? "devices/{device_key}/data",
    maxReconnectIntervalSec: (c.max_reconnect_interval_sec as number) ?? 10,
  };
}

function mqttPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.username !== undefined) p.username = c.username;
  if (c.password !== undefined) p.password = c.password;
  if (c.qos !== undefined) p.qos = c.qos;
  if (c.clean_session !== undefined) p.cleanSession = c.clean_session;
  if (c.keep_alive_sec !== undefined) p.keepAliveSec = c.keep_alive_sec;
  if (c.connection_timeout_sec !== undefined)
    p.connectionTimeoutSec = c.connection_timeout_sec;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_client_cert !== undefined) p.tlsClientCert = c.tls_client_cert;
  if (c.tls_client_key !== undefined) p.tlsClientKey = c.tls_client_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  if (c.subscribe_topics !== undefined) p.subscribeTopics = parseTopics(c.subscribe_topics);
  else if (c.topics !== undefined) p.subscribeTopics = parseTopics(c.topics);
  if (c.publish_topic_template !== undefined) p.publishTopicTemplate = c.publish_topic_template;
  else if (c.topic_template !== undefined) p.publishTopicTemplate = c.topic_template;
  if (c.max_reconnect_interval_sec !== undefined)
    p.maxReconnectIntervalSec = c.max_reconnect_interval_sec;
  return p;
}

function grpcClientDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string)!,
    port: (c.port as number) ?? 50051,
    serviceName: (c.service_name as string) ?? "",
    useTls: (c.use_tls as boolean) ?? true,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? (c.tls_client_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? (c.tls_client_key as string) ?? null,
    connectionTimeoutSec: (c.connection_timeout_sec as number) ?? 10,
    keepAliveSec: (c.keep_alive_sec as number) ?? 30,
    keepAliveTimeoutSec: (c.keep_alive_timeout_sec as number) ?? 10,
    maxIdleConns: (c.max_idle_conns as number) ?? 10,
    maxConnections: (c.max_connections as number) ?? 100,
  };
}
function grpcClientPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.service_name !== undefined) p.serviceName = c.service_name;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  else if (c.tls_client_cert !== undefined) p.tlsCert = c.tls_client_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  else if (c.tls_client_key !== undefined) p.tlsKey = c.tls_client_key;
  if (c.connection_timeout_sec !== undefined)
    p.connectionTimeoutSec = c.connection_timeout_sec;
  if (c.keep_alive_sec !== undefined) p.keepAliveSec = c.keep_alive_sec;
  if (c.keep_alive_timeout_sec !== undefined)
    p.keepAliveTimeoutSec = c.keep_alive_timeout_sec;
  if (c.max_idle_conns !== undefined) p.maxIdleConns = c.max_idle_conns;
  if (c.max_connections !== undefined) p.maxConnections = c.max_connections;
  return p;
}

function httpClientDefaults(c: Record<string, unknown>) {
  return {
    baseUrl: (c.base_url as string)!,
    method: (c.method as string) ?? "POST",
    headers: (c.headers as Record<string, string>) ?? {},
    authType: (c.auth_type as string) ?? "none",
    authCredentials: (c.auth_credentials as string) ?? null,
    useTls: (c.use_tls as boolean) ?? true,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? (c.tls_client_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? (c.tls_client_key as string) ?? null,
    tlsSkipVerify: (c.tls_skip_verify as boolean) ?? false,
    timeoutSec: (c.timeout_sec as number) ?? 30,
    contentType: (c.content_type as string) ?? "application/json",
    retryCount: (c.retry_count as number) ?? 3,
    retryDelaySec: (c.retry_delay_sec as number) ?? 5,
  };
}
function httpClientPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.base_url !== undefined) p.baseUrl = c.base_url;
  if (c.method !== undefined) p.method = c.method;
  if (c.headers !== undefined) p.headers = c.headers;
  if (c.auth_type !== undefined) p.authType = c.auth_type;
  if (c.auth_credentials !== undefined) p.authCredentials = c.auth_credentials;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  else if (c.tls_client_cert !== undefined) p.tlsCert = c.tls_client_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  else if (c.tls_client_key !== undefined) p.tlsKey = c.tls_client_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  if (c.timeout_sec !== undefined) p.timeoutSec = c.timeout_sec;
  if (c.content_type !== undefined) p.contentType = c.content_type;
  if (c.retry_count !== undefined) p.retryCount = c.retry_count;
  if (c.retry_delay_sec !== undefined) p.retryDelaySec = c.retry_delay_sec;
  return p;
}

function influxdb3Defaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string)!,
    port: (c.port as number) ?? 8086,
    token: (c.token as string) ?? "",
    influxdbOrg: (c.influxdb_org as string) ?? "",
    bucket: (c.bucket as string)!,
    measurement: (c.measurement as string) ?? "telemetry",
    useTls: (c.use_tls as boolean) ?? false,
    writePrecision: (c.write_precision as string) ?? "ns",
    batchSize: (c.batch_size as number) ?? 5000,
    flushIntervalMs: (c.flush_interval_ms as number) ?? 1000,
    maxRetries: (c.max_retries as number) ?? 3,
    retryDelayMs: (c.retry_delay_ms as number) ?? 500,
    workers: (c.workers as number) ?? 4,
  };
}
function influxdb3Patch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.token !== undefined) p.token = c.token;
  if (c.influxdb_org !== undefined) p.influxdbOrg = c.influxdb_org;
  if (c.bucket !== undefined) p.bucket = c.bucket;
  if (c.measurement !== undefined) p.measurement = c.measurement;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.write_precision !== undefined) p.writePrecision = c.write_precision;
  if (c.batch_size !== undefined) p.batchSize = c.batch_size;
  if (c.flush_interval_ms !== undefined)
    p.flushIntervalMs = c.flush_interval_ms;
  if (c.max_retries !== undefined) p.maxRetries = c.max_retries;
  if (c.retry_delay_ms !== undefined) p.retryDelayMs = c.retry_delay_ms;
  if (c.workers !== undefined) p.workers = c.workers;
  return p;
}

function clickhouseDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string)!,
    port: (c.port as number) ?? 9000,
    database: (c.database as string) ?? "default",
    username: (c.username as string) ?? "default",
    password: (c.password as string) ?? "",
    tableName: (c.table_name as string) ?? "telemetry",
    useTls: (c.use_tls as boolean) ?? false,
    batchSize: (c.batch_size as number) ?? 1000,
    flushIntervalMs: (c.flush_interval_ms as number) ?? 1000,
  };
}
function clickhousePatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.database !== undefined) p.database = c.database;
  if (c.username !== undefined) p.username = c.username;
  if (c.password !== undefined) p.password = c.password;
  if (c.table_name !== undefined) p.tableName = c.table_name;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.batch_size !== undefined) p.batchSize = c.batch_size;
  if (c.flush_interval_ms !== undefined)
    p.flushIntervalMs = c.flush_interval_ms;
  return p;
}

/** Serialize a DB config row to a flat JSON-friendly object */
// biome-ignore lint/suspicious/noExplicitAny: config can be any shape
function serializeConfig(
  type: IntegrationType,
  row: Record<string, any> | null,
) {
  if (!row) return null;
  switch (type) {
    case "grpc-server":
      return {
        id: row.id,
        host: row.host,
        port: row.port,
        service_name: row.serviceName,
        use_tls: row.useTls,
        tls_ca_cert: row.tlsCaCert,
        tls_cert: row.tlsCert,
        tls_key: row.tlsKey,
        max_connection_age_sec: row.maxConnectionAgeSec,
      };
    case "http-server":
      return {
        id: row.id,
        listen_path: row.listenPath,
        auth_type: row.authType,
        use_tls: row.useTls,
        tls_ca_cert: row.tlsCaCert,
        tls_cert: row.tlsCert,
        tls_key: row.tlsKey,
      };
    case "mqtt": {
      // Distinguish input vs output by presence of subscribeTopics / publishTopicTemplate
      const isOutput = row.publishTopicTemplate !== null && !row.subscribeTopics?.length;
      if (isOutput) {
        return {
          id: row.id,
          host: row.host,
          port: row.port,
          username: row.username,
          qos: row.qos,
          clean_session: row.cleanSession,
          keep_alive_sec: row.keepAliveSec,
          use_tls: row.useTls,
          tls_skip_verify: row.tlsSkipVerify,
          publish_topic_template: row.publishTopicTemplate,
          max_reconnect_interval_sec: row.maxReconnectIntervalSec,
        };
      }
      return {
        id: row.id,
        host: row.host,
        port: row.port,
        username: row.username,
        qos: row.qos,
        clean_session: row.cleanSession,
        keep_alive_sec: row.keepAliveSec,
        connection_timeout_sec: row.connectionTimeoutSec,
        use_tls: row.useTls,
        tls_skip_verify: row.tlsSkipVerify,
        subscribe_topics: row.subscribeTopics,
        publish_topic_template: row.publishTopicTemplate,
        max_reconnect_interval_sec: row.maxReconnectIntervalSec,
      };
    }
    case "grpc-client":
      return {
        id: row.id,
        host: row.host,
        port: row.port,
        service_name: row.serviceName,
        use_tls: row.useTls,
        connection_timeout_sec: row.connectionTimeoutSec,
        keep_alive_sec: row.keepAliveSec,
        keep_alive_timeout_sec: row.keepAliveTimeoutSec,
        max_idle_conns: row.maxIdleConns,
        max_connections: row.maxConnections,
      };
    case "http-client":
      return {
        id: row.id,
        base_url: row.baseUrl,
        method: row.method,
        headers: row.headers,
        auth_type: row.authType,
        use_tls: row.useTls,
        tls_skip_verify: row.tlsSkipVerify,
        timeout_sec: row.timeoutSec,
        content_type: row.contentType,
        retry_count: row.retryCount,
        retry_delay_sec: row.retryDelaySec,
      };
    case "influxdb3":
      return {
        id: row.id,
        host: row.host,
        port: row.port,
        influxdb_org: row.influxdbOrg,
        bucket: row.bucket,
        measurement: row.measurement,
        use_tls: row.useTls,
        write_precision: row.writePrecision,
        batch_size: row.batchSize,
        flush_interval_ms: row.flushIntervalMs,
        max_retries: row.maxRetries,
        retry_delay_ms: row.retryDelayMs,
        workers: row.workers,
        // Never expose token in list — only in detail
      };
    case "clickhouse":
      return {
        id: row.id,
        host: row.host,
        port: row.port,
        database: row.database,
        username: row.username,
        table_name: row.tableName,
        use_tls: row.useTls,
        batch_size: row.batchSize,
        flush_interval_ms: row.flushIntervalMs,
      };
    default:
      return row;
  }
}

// ── Integration live status via NATS Core ────────────────────────────────────
// Go services publish JSON to "sys.integration.status.{id}" every ~15 s.
// We subscribe once (lazy singleton) and cache the latest payload per id.

import {
  type NatsConnection,
  connect as natsConnect,
  StringCodec,
} from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";

type IntegrationStatusPayload = {
  integration_id: number;
  integration_type: string;
  team_id: number;
  team_name: string;
  broker?: string;
  topics?: string[];
  is_connected: boolean;
  message_count: number;
  error_count: number;
  last_message_at: string;
  reported_at: string;
};

const statusCache = new Map<number, IntegrationStatusPayload>();
let _natsConn: NatsConnection | null = null;
let _subscribed = false;

async function ensureStatusSubscription() {
  if (_subscribed) return;
  _subscribed = true; // set early to prevent race on concurrent requests
  try {
    if (!_natsConn || _natsConn.isClosed()) {
      _natsConn = await natsConnect({ servers: NATS_URL });
    }
    const sc = StringCodec();
    const sub = _natsConn.subscribe("sys.integration.status.>");
    (async () => {
      for await (const msg of sub) {
        try {
          const payload = JSON.parse(
            sc.decode(msg.data),
          ) as IntegrationStatusPayload;
          if (payload.integration_id) {
            statusCache.set(payload.integration_id, payload);
          }
        } catch {
          // ignore malformed
        }
      }
    })();
    console.log("[integrations] Subscribed to sys.integration.status.>");
  } catch (err) {
    _subscribed = false; // allow retry on next request
    console.warn("[integrations] NATS status subscription failed:", err);
  }
}

export function createIntegrationRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1" })

      // ── Providers (public reference data) ────────────────────────────────────
      .get("/integration-providers", async () => {
        const rows = await db
          .select()
          .from(integrationProvider)
          .orderBy(asc(integrationProvider.id));
        return {
          success: true as const,
          data: rows.map((r) => ({
            id: r.id,
            code: r.code,
            display_name: r.displayName,
            description: r.description,
            is_builtin: r.isBuiltin,
          })),
        };
      })

      // ── Authenticated routes ──────────────────────────────────────────────────
      .use(requireAuth())

      // Live connection statuses (sourced from NATS Core heartbeats)
      .get("/integrations/statuses", async (ctx) => {
        const _auth = (ctx as unknown as { auth: AuthContext }).auth;
        void _auth; // auth is enforced by requireAuth middleware
        await ensureStatusSubscription();
        return {
          success: true as const,
          data: Object.fromEntries(statusCache),
        };
      })

      // List integrations
      .get("/integrations", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const { org_id, team_id, type, direction } = ctx.query as {
          org_id?: string;
          team_id?: string;
          type?: string;
          direction?: string;
        };

        const filters = [];
        if (auth.role === "superAdmin") {
          if (org_id)
            filters.push(
              eq(integrationRegistry.organizationId, Number(org_id)),
            );
        } else {
          const orgId = auth.orgId;
          if (!orgId)
            return {
              success: false as const,
              error: "Organization context required",
            };
          filters.push(
            or(
              eq(integrationRegistry.organizationId, orgId),
              eq(integrationRegistry.isGlobal, true),
            )!,
          );
          if (team_id)
            filters.push(eq(integrationRegistry.teamId, Number(team_id)));
        }
        if (type) filters.push(eq(integrationRegistry.type, type));
        if (direction)
          filters.push(eq(integrationRegistry.direction, direction));

        const rows = await db
          .select({
            id: integrationRegistry.id,
            name: integrationRegistry.name,
            description: integrationRegistry.description,
            type: integrationRegistry.type,
            direction: integrationRegistry.direction,
            organizationId: integrationRegistry.organizationId,
            teamId: integrationRegistry.teamId,
            providerId: integrationRegistry.providerId,
            providerCode: integrationProvider.code,
            providerName: integrationProvider.displayName,
            isGlobal: integrationRegistry.isGlobal,
            isActive: integrationRegistry.isActive,
            createdAt: integrationRegistry.createdAt,
            updatedAt: integrationRegistry.updatedAt,
          })
          .from(integrationRegistry)
          .leftJoin(
            integrationProvider,
            eq(integrationRegistry.providerId, integrationProvider.id),
          )
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(asc(integrationRegistry.id));

        // Fetch config for each integration
        const data = await Promise.all(
          rows.map(async (r) => {
            const cfg = await fetchConfig(db, r.type as IntegrationType, r.id);
            return {
              id: r.id,
              name: r.name,
              description: r.description,
              type: r.type,
              direction: r.direction,
              organization_id: r.organizationId,
              team_id: r.teamId,
              provider: r.providerId
                ? {
                  id: r.providerId,
                  code: r.providerCode,
                  display_name: r.providerName,
                }
                : null,
              is_global: r.isGlobal,
              is_active: r.isActive,
              config: serializeConfig(
                r.type as IntegrationType,
                cfg as Record<string, unknown> | null,
              ),
              created_at: r.createdAt,
              updated_at: r.updatedAt,
            };
          }),
        );

        return { success: true as const, data, total: data.length };
      })

      // Get single integration
      .get("/integrations/:id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [row] = await db
          .select({
            id: integrationRegistry.id,
            name: integrationRegistry.name,
            description: integrationRegistry.description,
            type: integrationRegistry.type,
            direction: integrationRegistry.direction,
            organizationId: integrationRegistry.organizationId,
            teamId: integrationRegistry.teamId,
            providerId: integrationRegistry.providerId,
            providerCode: integrationProvider.code,
            providerName: integrationProvider.displayName,
            isGlobal: integrationRegistry.isGlobal,
            isActive: integrationRegistry.isActive,
            createdBy: integrationRegistry.createdBy,
            updatedBy: integrationRegistry.updatedBy,
            createdAt: integrationRegistry.createdAt,
            updatedAt: integrationRegistry.updatedAt,
          })
          .from(integrationRegistry)
          .leftJoin(
            integrationProvider,
            eq(integrationRegistry.providerId, integrationProvider.id),
          )
          .where(eq(integrationRegistry.id, id))
          .limit(1);

        if (!row) {
          ctx.set.status = 404;
          return { success: false as const, error: "Not found" };
        }

        // Access check
        if (
          auth.role !== "superAdmin" &&
          row.organizationId !== auth.orgId &&
          !row.isGlobal
        ) {
          ctx.set.status = 403;
          return { success: false as const, error: "Access denied" };
        }

        const cfg = await fetchConfig(db, row.type as IntegrationType, row.id);

        // For detail requests, include sensitive fields (token, passwords)
        // biome-ignore lint/suspicious/noExplicitAny: config can be any shape
        const cfgWithSecrets = cfg
          ? {
            ...serializeConfig(
              row.type as IntegrationType,
              cfg as Record<string, any>,
            )!,
          }
          : null;
        if (cfg && "token" in cfg && cfgWithSecrets)
          (cfgWithSecrets as Record<string, unknown>).token = (
            cfg as Record<string, unknown>
          ).token;
        if (cfg && "password" in cfg && cfgWithSecrets)
          (cfgWithSecrets as Record<string, unknown>).password = (
            cfg as Record<string, unknown>
          ).password;
        if (cfg && "authCredentials" in cfg && cfgWithSecrets)
          (cfgWithSecrets as Record<string, unknown>).auth_credentials = (
            cfg as Record<string, unknown>
          ).authCredentials;

        return {
          success: true as const,
          data: {
            id: row.id,
            name: row.name,
            description: row.description,
            type: row.type,
            direction: row.direction,
            organization_id: row.organizationId,
            team_id: row.teamId,
            provider: row.providerId
              ? {
                id: row.providerId,
                code: row.providerCode,
                display_name: row.providerName,
              }
              : null,
            is_global: row.isGlobal,
            is_active: row.isActive,
            created_by: row.createdBy,
            updated_by: row.updatedBy,
            config: cfgWithSecrets,
            created_at: row.createdAt,
            updated_at: row.updatedAt,
          },
        };
      })

      // Create integration
      .post(
        "/integrations",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const body = ctx.body as {
            name: string;
            description?: string;
            type: IntegrationType;
            direction?: Direction;
            organization_id?: number;
            team_id?: number;
            provider_id?: number;
            is_global?: boolean;
            config: Record<string, unknown>;
          };

          const orgId = body.organization_id ?? auth.orgId;
          if (!orgId) {
            ctx.set.status = 422;
            return {
              success: false as const,
              error: "organization_id required",
            };
          }

          const direction: Direction =
            body.direction ?? directionForType(body.type) ?? "input";

          const [reg] = await db
            .insert(integrationRegistry)
            .values({
              name: body.name,
              description: body.description ?? null,
              type: body.type,
              direction,
              organizationId: orgId,
              teamId: body.team_id ?? null,
              providerId: body.provider_id ?? null,
              isGlobal: body.is_global ?? false,
              isActive: true,
              createdBy: auth.userId ?? null,
              updatedBy: auth.userId ?? null,
            })
            .returning();

          const cfg = await insertConfig(
            db,
            body.type,
            reg.id,
            body.config ?? {},
            direction,
          );

          return {
            success: true as const,
            data: {
              id: reg.id,
              name: reg.name,
              type: reg.type,
              direction: reg.direction,
              organization_id: reg.organizationId,
              team_id: reg.teamId,
              provider_id: reg.providerId,
              is_global: reg.isGlobal,
              is_active: reg.isActive,
              config: serializeConfig(
                body.type,
                cfg as Record<string, unknown>,
              ),
              created_at: reg.createdAt,
              updated_at: reg.updatedAt,
            },
          };
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1 }),
            description: t.Optional(t.String()),
            type: t.Union([
              t.Literal("grpc-server"),
              t.Literal("grpc-client"),
              t.Literal("http-server"),
              t.Literal("http-client"),
              t.Literal("mqtt"),
              t.Literal("influxdb3"),
              t.Literal("clickhouse"),
            ]),
            direction: t.Optional(t.Union([t.Literal("input"), t.Literal("output")])),
            organization_id: t.Optional(t.Number()),
            team_id: t.Optional(t.Number()),
            provider_id: t.Optional(t.Number()),
            is_global: t.Optional(t.Boolean()),
            config: t.Record(t.String(), t.Unknown()),
          }),
        },
      )

      // Update integration
      .put(
        "/integrations/:id",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const id = Number(ctx.params.id);
          const body = ctx.body as Partial<{
            name: string;
            description: string;
            provider_id: number | null;
            is_global: boolean;
            is_active: boolean;
            config: Record<string, unknown>;
          }>;

          const [existing] = await db
            .select()
            .from(integrationRegistry)
            .where(eq(integrationRegistry.id, id))
            .limit(1);

          if (!existing) {
            ctx.set.status = 404;
            return { success: false as const, error: "Not found" };
          }

          if (
            auth.role !== "superAdmin" &&
            existing.organizationId !== auth.orgId
          ) {
            ctx.set.status = 403;
            return { success: false as const, error: "Access denied" };
          }

          const regUpdates: Partial<typeof integrationRegistry.$inferInsert> = {
            updatedAt: new Date(),
            updatedBy: auth.userId ?? undefined,
          };
          if (body.name !== undefined) regUpdates.name = body.name;
          if (body.description !== undefined)
            regUpdates.description = body.description;
          if (body.provider_id !== undefined)
            regUpdates.providerId = body.provider_id;
          if (body.is_global !== undefined)
            regUpdates.isGlobal = body.is_global;
          if (body.is_active !== undefined)
            regUpdates.isActive = body.is_active;

          const [updated] = await db
            .update(integrationRegistry)
            .set(regUpdates)
            .where(eq(integrationRegistry.id, id))
            .returning();

          if (body.config && Object.keys(body.config).length > 0) {
            await patchConfig(
              db,
              existing.type as IntegrationType,
              id,
              body.config,
            );
          }

          const cfg = await fetchConfig(
            db,
            existing.type as IntegrationType,
            id,
          );

          // Fetch provider object (consistent with GET response shape)
          let provider: { id: number; code: string; display_name: string } | null = null;
          const effectiveProviderId = updated.providerId;
          if (effectiveProviderId) {
            const [prov] = await db
              .select({
                id: integrationProvider.id,
                code: integrationProvider.code,
                displayName: integrationProvider.displayName,
              })
              .from(integrationProvider)
              .where(eq(integrationProvider.id, effectiveProviderId))
              .limit(1);
            if (prov) provider = { id: prov.id, code: prov.code, display_name: prov.displayName };
          }

          return {
            success: true as const,
            data: {
              id: updated.id,
              name: updated.name,
              type: updated.type,
              direction: updated.direction,
              organization_id: updated.organizationId,
              team_id: updated.teamId,
              provider,
              is_global: updated.isGlobal,
              is_active: updated.isActive,
              config: serializeConfig(
                existing.type as IntegrationType,
                cfg as Record<string, unknown> | null,
              ),
              created_at: updated.createdAt,
              updated_at: updated.updatedAt,
            },
          };
        },
        {
          body: t.Object({
            name: t.Optional(t.String({ minLength: 1 })),
            description: t.Optional(t.String()),
            provider_id: t.Optional(t.Union([t.Number(), t.Null()])),
            is_global: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
            config: t.Optional(t.Record(t.String(), t.Unknown())),
          }),
        },
      )

      // Delete integration (cascades to config via FK)
      .delete("/integrations/:id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [existing] = await db
          .select()
          .from(integrationRegistry)
          .where(eq(integrationRegistry.id, id))
          .limit(1);

        if (!existing) {
          ctx.set.status = 404;
          return { success: false as const, error: "Not found" };
        }

        if (
          auth.role !== "superAdmin" &&
          existing.organizationId !== auth.orgId
        ) {
          ctx.set.status = 403;
          return { success: false as const, error: "Access denied" };
        }

        await db
          .delete(integrationRegistry)
          .where(eq(integrationRegistry.id, id));

        return { success: true as const };
      })

      // Test connectivity
      .post("/integrations/:id/test", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [row] = await db
          .select()
          .from(integrationRegistry)
          .where(eq(integrationRegistry.id, id))
          .limit(1);

        if (!row) {
          ctx.set.status = 404;
          return { success: false as const, error: "Not found" };
        }

        if (
          auth.role !== "superAdmin" &&
          row.organizationId !== auth.orgId &&
          !row.isGlobal
        ) {
          ctx.set.status = 403;
          return { success: false as const, error: "Access denied" };
        }

        const cfg = await fetchConfig(db, row.type as IntegrationType, id);
        if (!cfg) {
          return { success: false as const, error: "No config found" };
        }

        try {
          switch (row.type) {
            case "influxdb3": {
              const c = cfg as typeof integrationConfigInfluxdb3.$inferSelect;
              const proto = c.useTls ? "https" : "http";
              const url = `${proto}://${c.host}:${c.port}/health`;
              const resp = await fetch(url, {
                signal: AbortSignal.timeout(5000),
              });
              return {
                success: resp.ok,
                data: { status: resp.ok ? "ok" : "unreachable" },
              };
            }
            case "http-client": {
              const c = cfg as typeof integrationConfigHttp.$inferSelect;
              const url = new URL("/", c.baseUrl);
              const resp = await fetch(url.toString(), {
                method: "HEAD",
                signal: AbortSignal.timeout(5000),
              });
              return {
                success: resp.ok || resp.status < 500,
                data: { status: resp.status },
              };
            }
            default:
              return {
                success: false as const,
                error: `Test not supported for type: ${row.type}`,
              };
          }
        } catch (e: unknown) {
          return {
            success: false as const,
            error: e instanceof Error ? e.message : "Connection failed",
          };
        }
      })
  );
}
