/**
 * Service Registry API Routes
 *
 * Provides CRUD for the unified service layer:
 *   GET  /api/v1/service-providers         — list all codec/parser providers
 *   GET  /api/v1/services                  — list all service entries
 *   POST /api/v1/services                  — create service + type config
 *   GET  /api/v1/services/:id              — get single service with config
 *   PUT  /api/v1/services/:id              — update service and/or config
 *   DELETE /api/v1/services/:id            — delete (cascades to config)
 *   POST /api/v1/services/:id/test         — test connectivity
 *   GET  /api/v1/services/statuses         — live NATS-sourced connection status
 */

import { and, asc, eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import {
  type ServiceType,
  serviceInputGrpcpullConfig,
  serviceInputGrpcserverConfig,
  serviceInputHttppullConfig,
  serviceInputHttpserverConfig,
  serviceInputInfluxdb3Config,
  serviceInputMqttConfig,
  serviceOutputClickhouseConfig,
  serviceOutputGrpcpushConfig,
  serviceOutputHttppushConfig,
  serviceOutputInfluxdb3Config,
  serviceOutputMqttConfig,
  serviceProvider,
  serviceRegistry,
} from "../db/schema";

/** Fetch the type-specific config row for a service */
async function fetchConfig(
  db: DrizzleDB,
  serviceType: ServiceType,
  serviceId: number,
) {
  switch (serviceType) {
    case "input.mqtt":
      return (
        (
          await db
            .select()
            .from(serviceInputMqttConfig)
            .where(eq(serviceInputMqttConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "output.mqtt":
      return (
        (
          await db
            .select()
            .from(serviceOutputMqttConfig)
            .where(eq(serviceOutputMqttConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "input.grpc-server":
      return (
        (
          await db
            .select()
            .from(serviceInputGrpcserverConfig)
            .where(eq(serviceInputGrpcserverConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "input.grpc-pull":
      return (
        (
          await db
            .select()
            .from(serviceInputGrpcpullConfig)
            .where(eq(serviceInputGrpcpullConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "input.http-server":
      return (
        (
          await db
            .select()
            .from(serviceInputHttpserverConfig)
            .where(eq(serviceInputHttpserverConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "input.http-pull":
      return (
        (
          await db
            .select()
            .from(serviceInputHttppullConfig)
            .where(eq(serviceInputHttppullConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "output.grpc-push":
      return (
        (
          await db
            .select()
            .from(serviceOutputGrpcpushConfig)
            .where(eq(serviceOutputGrpcpushConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "output.http-push":
      return (
        (
          await db
            .select()
            .from(serviceOutputHttppushConfig)
            .where(eq(serviceOutputHttppushConfig.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "input.influxdb3":
      return (
        (
          await db
            .select()
            .from(serviceInputInfluxdb3Config)
            .where(eq(serviceInputInfluxdb3Config.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "output.influxdb3":
      return (
        (
          await db
            .select()
            .from(serviceOutputInfluxdb3Config)
            .where(eq(serviceOutputInfluxdb3Config.serviceId, serviceId))
            .limit(1)
        )[0] ?? null
      );
    case "output.clickhouse":
      return (
        (
          await db
            .select()
            .from(serviceOutputClickhouseConfig)
            .where(eq(serviceOutputClickhouseConfig.serviceId, serviceId))
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
  serviceType: ServiceType,
  serviceId: number,
  cfg: Record<string, unknown>,
) {
  switch (serviceType) {
    case "input.mqtt":
      return (
        await db
          .insert(serviceInputMqttConfig)
          .values({ serviceId, ...mqttInputDefaults(cfg) })
          .returning()
      )[0];
    case "output.mqtt":
      return (
        await db
          .insert(serviceOutputMqttConfig)
          .values({ serviceId, ...mqttOutputDefaults(cfg) })
          .returning()
      )[0];
    case "input.grpc-server":
      return (
        await db
          .insert(serviceInputGrpcserverConfig)
          .values({ serviceId, ...grpcServerDefaults(cfg) })
          .returning()
      )[0];
    case "input.grpc-pull":
      return (
        await db
          .insert(serviceInputGrpcpullConfig)
          .values({ serviceId, ...grpcClientDefaults(cfg) })
          .returning()
      )[0];
    case "input.http-server":
      return (
        await db
          .insert(serviceInputHttpserverConfig)
          .values({ serviceId, ...httpServerDefaults(cfg) })
          .returning()
      )[0];
    case "input.http-pull":
      return (
        await db
          .insert(serviceInputHttppullConfig)
          .values({ serviceId, ...httpPullDefaults(cfg) })
          .returning()
      )[0];
    case "output.grpc-push":
      return (
        await db
          .insert(serviceOutputGrpcpushConfig)
          .values({ serviceId, ...grpcClientDefaults(cfg) })
          .returning()
      )[0];
    case "output.http-push":
      return (
        await db
          .insert(serviceOutputHttppushConfig)
          .values({ serviceId, ...httpPushDefaults(cfg) })
          .returning()
      )[0];
    case "input.influxdb3":
      return (
        await db
          .insert(serviceInputInfluxdb3Config)
          .values({ serviceId, ...influxdb3Defaults(cfg) })
          .returning()
      )[0];
    case "output.influxdb3":
      return (
        await db
          .insert(serviceOutputInfluxdb3Config)
          .values({ serviceId, ...influxdb3Defaults(cfg) })
          .returning()
      )[0];
    case "output.clickhouse":
      return (
        await db
          .insert(serviceOutputClickhouseConfig)
          .values({ serviceId, ...clickhouseDefaults(cfg) })
          .returning()
      )[0];
  }
}

/** Patch a type-specific config row */
async function patchConfig(
  db: DrizzleDB,
  serviceType: ServiceType,
  serviceId: number,
  cfg: Record<string, unknown>,
) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  switch (serviceType) {
    case "input.mqtt":
      Object.assign(updates, mqttInputPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceInputMqttConfig)
          .set(updates)
          .where(eq(serviceInputMqttConfig.serviceId, serviceId));
      break;
    case "output.mqtt":
      Object.assign(updates, mqttOutputPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceOutputMqttConfig)
          .set(updates)
          .where(eq(serviceOutputMqttConfig.serviceId, serviceId));
      break;
    case "input.grpc-server":
      Object.assign(updates, grpcServerPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceInputGrpcserverConfig)
          .set(updates)
          .where(eq(serviceInputGrpcserverConfig.serviceId, serviceId));
      break;
    case "input.grpc-pull":
      Object.assign(updates, grpcClientPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceInputGrpcpullConfig)
          .set(updates)
          .where(eq(serviceInputGrpcpullConfig.serviceId, serviceId));
      break;
    case "input.http-server":
      Object.assign(updates, httpServerPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceInputHttpserverConfig)
          .set(updates)
          .where(eq(serviceInputHttpserverConfig.serviceId, serviceId));
      break;
    case "input.http-pull":
      Object.assign(updates, httpPullPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceInputHttppullConfig)
          .set(updates)
          .where(eq(serviceInputHttppullConfig.serviceId, serviceId));
      break;
    case "output.grpc-push":
      Object.assign(updates, grpcClientPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceOutputGrpcpushConfig)
          .set(updates)
          .where(eq(serviceOutputGrpcpushConfig.serviceId, serviceId));
      break;
    case "output.http-push":
      Object.assign(updates, httpPushPatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceOutputHttppushConfig)
          .set(updates)
          .where(eq(serviceOutputHttppushConfig.serviceId, serviceId));
      break;
    case "input.influxdb3":
      Object.assign(updates, influxdb3Patch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceInputInfluxdb3Config)
          .set(updates)
          .where(eq(serviceInputInfluxdb3Config.serviceId, serviceId));
      break;
    case "output.influxdb3":
      Object.assign(updates, influxdb3Patch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceOutputInfluxdb3Config)
          .set(updates)
          .where(eq(serviceOutputInfluxdb3Config.serviceId, serviceId));
      break;
    case "output.clickhouse":
      Object.assign(updates, clickhousePatch(cfg));
      if (Object.keys(updates).length > 1)
        await db
          .update(serviceOutputClickhouseConfig)
          .set(updates)
          .where(eq(serviceOutputClickhouseConfig.serviceId, serviceId));
      break;
  }
}

// ── Config value helpers ─────────────────────────────────────────────────────

function mqttInputDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string) ?? "",
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
    subscribeTopics: (c.subscribe_topics as unknown[]) ?? (c.topics as unknown[]) ?? [],
    publishTopicTemplate: (c.publish_topic_template as string) ?? "devices/{device_key}/command",
    maxReconnectIntervalSec: (c.max_reconnect_interval_sec as number) ?? 10,
  };
}
function mqttInputPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.username !== undefined) p.username = c.username;
  if (c.password !== undefined) p.password = c.password;
  if (c.qos !== undefined) p.qos = c.qos;
  if (c.clean_session !== undefined) p.cleanSession = c.clean_session;
  if (c.keep_alive_sec !== undefined) p.keepAliveSec = c.keep_alive_sec;
  if (c.connection_timeout_sec !== undefined) p.connectionTimeoutSec = c.connection_timeout_sec;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_client_cert !== undefined) p.tlsClientCert = c.tls_client_cert;
  if (c.tls_client_key !== undefined) p.tlsClientKey = c.tls_client_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  if (c.subscribe_topics !== undefined) p.subscribeTopics = c.subscribe_topics;
  else if (c.topics !== undefined) p.subscribeTopics = c.topics;
  if (c.publish_topic_template !== undefined) p.publishTopicTemplate = c.publish_topic_template;
  if (c.max_reconnect_interval_sec !== undefined) p.maxReconnectIntervalSec = c.max_reconnect_interval_sec;
  return p;
}

function mqttOutputDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string) ?? "",
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
    publishTopicTemplate: (c.publish_topic_template as string) ?? (c.topic_template as string) ?? "devices/{device_key}/data",
    maxReconnectIntervalSec: (c.max_reconnect_interval_sec as number) ?? 10,
  };
}
function mqttOutputPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.host !== undefined) p.host = c.host;
  if (c.port !== undefined) p.port = c.port;
  if (c.username !== undefined) p.username = c.username;
  if (c.password !== undefined) p.password = c.password;
  if (c.qos !== undefined) p.qos = c.qos;
  if (c.clean_session !== undefined) p.cleanSession = c.clean_session;
  if (c.keep_alive_sec !== undefined) p.keepAliveSec = c.keep_alive_sec;
  if (c.connection_timeout_sec !== undefined) p.connectionTimeoutSec = c.connection_timeout_sec;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_client_cert !== undefined) p.tlsClientCert = c.tls_client_cert;
  if (c.tls_client_key !== undefined) p.tlsClientKey = c.tls_client_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  if (c.publish_topic_template !== undefined) p.publishTopicTemplate = c.publish_topic_template;
  else if (c.topic_template !== undefined) p.publishTopicTemplate = c.topic_template;
  if (c.max_reconnect_interval_sec !== undefined) p.maxReconnectIntervalSec = c.max_reconnect_interval_sec;
  return p;
}

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
  if (c.max_connection_age_sec !== undefined) p.maxConnectionAgeSec = c.max_connection_age_sec;
  return p;
}

function grpcClientDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string) ?? "",
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
  if (c.connection_timeout_sec !== undefined) p.connectionTimeoutSec = c.connection_timeout_sec;
  if (c.keep_alive_sec !== undefined) p.keepAliveSec = c.keep_alive_sec;
  if (c.keep_alive_timeout_sec !== undefined) p.keepAliveTimeoutSec = c.keep_alive_timeout_sec;
  if (c.max_idle_conns !== undefined) p.maxIdleConns = c.max_idle_conns;
  if (c.max_connections !== undefined) p.maxConnections = c.max_connections;
  return p;
}

function httpServerDefaults(c: Record<string, unknown>) {
  return {
    listenPath: (c.listen_path as string) ?? "/ingest",
    headers: (c.headers as Record<string, string>) ?? {},
    authType: (c.auth_type as string) ?? "none",
    authCredentials: (c.auth_credentials as string) ?? (c.auth_secret as string) ?? null,
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? null,
    tlsSkipVerify: (c.tls_skip_verify as boolean) ?? false,
  };
}
function httpServerPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.listen_path !== undefined) p.listenPath = c.listen_path;
  if (c.headers !== undefined) p.headers = c.headers;
  if (c.auth_type !== undefined) p.authType = c.auth_type;
  if (c.auth_credentials !== undefined) p.authCredentials = c.auth_credentials;
  else if (c.auth_secret !== undefined) p.authCredentials = c.auth_secret;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  return p;
}

function httpPullDefaults(c: Record<string, unknown>) {
  return {
    baseUrl: (c.base_url as string) ?? "",
    method: (c.method as string) ?? "GET",
    headers: (c.headers as Record<string, string>) ?? {},
    timeoutSec: (c.timeout_sec as number) ?? 30,
    contentType: (c.content_type as string) ?? "application/json",
    retryCount: (c.retry_count as number) ?? 3,
    retryDelaySec: (c.retry_delay_sec as number) ?? 5,
    authType: (c.auth_type as string) ?? "none",
    authCredentials: (c.auth_credentials as string) ?? null,
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? null,
    tlsSkipVerify: (c.tls_skip_verify as boolean) ?? false,
  };
}
function httpPullPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.base_url !== undefined) p.baseUrl = c.base_url;
  if (c.method !== undefined) p.method = c.method;
  if (c.headers !== undefined) p.headers = c.headers;
  if (c.timeout_sec !== undefined) p.timeoutSec = c.timeout_sec;
  if (c.content_type !== undefined) p.contentType = c.content_type;
  if (c.retry_count !== undefined) p.retryCount = c.retry_count;
  if (c.retry_delay_sec !== undefined) p.retryDelaySec = c.retry_delay_sec;
  if (c.auth_type !== undefined) p.authType = c.auth_type;
  if (c.auth_credentials !== undefined) p.authCredentials = c.auth_credentials;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  return p;
}

function httpPushDefaults(c: Record<string, unknown>) {
  return {
    baseUrl: (c.base_url as string) ?? "",
    method: (c.method as string) ?? "POST",
    headers: (c.headers as Record<string, string>) ?? {},
    timeoutSec: (c.timeout_sec as number) ?? 30,
    contentType: (c.content_type as string) ?? "application/json",
    retryCount: (c.retry_count as number) ?? 3,
    retryDelaySec: (c.retry_delay_sec as number) ?? 5,
    authType: (c.auth_type as string) ?? "none",
    authCredentials: (c.auth_credentials as string) ?? null,
    useTls: (c.use_tls as boolean) ?? false,
    tlsCaCert: (c.tls_ca_cert as string) ?? null,
    tlsCert: (c.tls_cert as string) ?? null,
    tlsKey: (c.tls_key as string) ?? null,
    tlsSkipVerify: (c.tls_skip_verify as boolean) ?? false,
  };
}
function httpPushPatch(c: Record<string, unknown>) {
  const p: Record<string, unknown> = {};
  if (c.base_url !== undefined) p.baseUrl = c.base_url;
  if (c.method !== undefined) p.method = c.method;
  if (c.headers !== undefined) p.headers = c.headers;
  if (c.timeout_sec !== undefined) p.timeoutSec = c.timeout_sec;
  if (c.content_type !== undefined) p.contentType = c.content_type;
  if (c.retry_count !== undefined) p.retryCount = c.retry_count;
  if (c.retry_delay_sec !== undefined) p.retryDelaySec = c.retry_delay_sec;
  if (c.auth_type !== undefined) p.authType = c.auth_type;
  if (c.auth_credentials !== undefined) p.authCredentials = c.auth_credentials;
  if (c.use_tls !== undefined) p.useTls = c.use_tls;
  if (c.tls_ca_cert !== undefined) p.tlsCaCert = c.tls_ca_cert;
  if (c.tls_cert !== undefined) p.tlsCert = c.tls_cert;
  if (c.tls_key !== undefined) p.tlsKey = c.tls_key;
  if (c.tls_skip_verify !== undefined) p.tlsSkipVerify = c.tls_skip_verify;
  return p;
}

function influxdb3Defaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string) ?? "",
    port: (c.port as number) ?? 8086,
    token: (c.token as string) ?? "",
    influxdbOrg: (c.influxdb_org as string) ?? "",
    bucket: (c.bucket as string) ?? "",
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
  if (c.flush_interval_ms !== undefined) p.flushIntervalMs = c.flush_interval_ms;
  if (c.max_retries !== undefined) p.maxRetries = c.max_retries;
  if (c.retry_delay_ms !== undefined) p.retryDelayMs = c.retry_delay_ms;
  if (c.workers !== undefined) p.workers = c.workers;
  return p;
}

function clickhouseDefaults(c: Record<string, unknown>) {
  return {
    host: (c.host as string) ?? "",
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
  if (c.flush_interval_ms !== undefined) p.flushIntervalMs = c.flush_interval_ms;
  return p;
}

/** Serialize a DB config row to a flat JSON-friendly object.
 *  Strips internal fields (id, service_id) and renames camelCase to snake_case. */
function serializeConfig(
  serviceType: ServiceType,
  row: Record<string, unknown> | null,
) {
  if (!row) return null;
  switch (serviceType) {
    case "input.mqtt":
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
    case "output.mqtt":
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
        publish_topic_template: row.publishTopicTemplate,
        max_reconnect_interval_sec: row.maxReconnectIntervalSec,
      };
    case "input.grpc-server":
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
    case "input.grpc-pull":
    case "output.grpc-push":
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
    case "input.http-server":
      return {
        id: row.id,
        listen_path: row.listenPath,
        headers: row.headers,
        auth_type: row.authType,
        use_tls: row.useTls,
        tls_ca_cert: row.tlsCaCert,
        tls_cert: row.tlsCert,
        tls_key: row.tlsKey,
        tls_skip_verify: row.tlsSkipVerify,
      };
    case "input.http-pull":
    case "output.http-push":
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
    case "input.influxdb3":
    case "output.influxdb3":
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
    case "output.clickhouse":
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

// ── Service live status via NATS Core ────────────────────────────────────────
// Go services publish JSON to "sys.service.status.{id}" every ~15 s.
// We subscribe once (lazy singleton) and cache the latest payload per id.

import {
  type NatsConnection,
  connect as natsConnect,
  StringCodec,
} from "nats";

const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";

type ServiceStatusPayload = {
  service_id: number;
  service_type: string;
  org_id?: number;
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

const statusCache = new Map<number, ServiceStatusPayload>();
let _subscribed = false;

async function ensureStatusSubscription(nc: NatsConnection | null) {
  if (_subscribed) return;
  _subscribed = true;
  try {
    // Prefer the shared API NATS connection; fall back to a dedicated one
    if (!nc || nc.isClosed()) {
      nc = await natsConnect({ servers: NATS_URL });
    }
    const sc = StringCodec();
    const sub = nc.subscribe("sys.service.status.>");
    (async () => {
      for await (const msg of sub) {
        try {
          const payload = JSON.parse(
            sc.decode(msg.data),
          ) as ServiceStatusPayload;
          if (payload.service_id) {
            statusCache.set(payload.service_id, payload);
          }
        } catch {
          // ignore malformed
        }
      }
    })();
    console.log("[services] Subscribed to sys.service.status.>");
  } catch (err) {
    _subscribed = false;
    console.warn("[services] NATS status subscription failed:", err);
  }
}


/** All valid service_type values for request validation */
const SERVICE_TYPES = [
  "input.mqtt",
  "input.grpc-server",
  "input.grpc-pull",
  "input.http-server",
  "input.http-pull",
  "input.influxdb3",
  "output.mqtt",
  "output.grpc-push",
  "output.http-push",
  "output.influxdb3",
  "output.clickhouse",
] as const;

export function createServiceRoutes(db: DrizzleDB, nc?: NatsConnection | null) {
  return (
    new Elysia({ prefix: "/api/v1" })

      // ── Providers (public reference data) ────────────────────────────────────
      .get("/service-providers", async () => {
        const rows = await db
          .select()
          .from(serviceProvider)
          .orderBy(asc(serviceProvider.id));
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
      .get("/services/statuses", async (ctx) => {
        const _auth = (ctx as unknown as { auth: AuthContext }).auth;
        void _auth;
        await ensureStatusSubscription(nc ?? null);
        return {
          success: true as const,
          data: Object.fromEntries(statusCache),
        };
      })

      // List services
      .get("/services", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const { org_id, team_id, service_type } = ctx.query as {
          org_id?: string;
          team_id?: string;
          service_type?: string;
        };

        const filters = [];
        if (auth.role === "superAdmin") {
          if (org_id)
            filters.push(
              eq(serviceRegistry.organizationId, Number(org_id)),
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
              eq(serviceRegistry.organizationId, orgId),
              eq(serviceRegistry.isGlobal, true),
            ),
          );
          if (team_id)
            filters.push(eq(serviceRegistry.teamId, Number(team_id)));
        }
        if (service_type)
          filters.push(eq(serviceRegistry.serviceType, service_type as ServiceType));

        const rows = await db
          .select({
            id: serviceRegistry.id,
            name: serviceRegistry.name,
            description: serviceRegistry.description,
            serviceType: serviceRegistry.serviceType,
            organizationId: serviceRegistry.organizationId,
            teamId: serviceRegistry.teamId,
            providerId: serviceRegistry.providerId,
            providerCode: serviceProvider.code,
            providerName: serviceProvider.displayName,
            isGlobal: serviceRegistry.isGlobal,
            isLoraWan: serviceRegistry.isLoraWan,
            isActive: serviceRegistry.isActive,
            createdAt: serviceRegistry.createdAt,
            updatedAt: serviceRegistry.updatedAt,
          })
          .from(serviceRegistry)
          .leftJoin(
            serviceProvider,
            eq(serviceRegistry.providerId, serviceProvider.id),
          )
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(asc(serviceRegistry.id));

        const data = await Promise.all(
          rows.map(async (r) => {
            const cfg = await fetchConfig(db, r.serviceType as ServiceType, r.id);
            return {
              id: r.id,
              name: r.name,
              description: r.description,
              service_type: r.serviceType,
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
              is_lorawan: r.isLoraWan,
              is_active: r.isActive,
              config: serializeConfig(
                r.serviceType as ServiceType,
                cfg as Record<string, unknown> | null,
              ),
              created_at: r.createdAt,
              updated_at: r.updatedAt,
            };
          }),
        );

        return { success: true as const, data, total: data.length };
      })

      // Get single service
      .get("/services/:id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [row] = await db
          .select({
            id: serviceRegistry.id,
            name: serviceRegistry.name,
            description: serviceRegistry.description,
            serviceType: serviceRegistry.serviceType,
            organizationId: serviceRegistry.organizationId,
            teamId: serviceRegistry.teamId,
            providerId: serviceRegistry.providerId,
            providerCode: serviceProvider.code,
            providerName: serviceProvider.displayName,
            isGlobal: serviceRegistry.isGlobal,
            isActive: serviceRegistry.isActive,
            createdBy: serviceRegistry.createdBy,
            updatedBy: serviceRegistry.updatedBy,
            createdAt: serviceRegistry.createdAt,
            updatedAt: serviceRegistry.updatedAt,
          })
          .from(serviceRegistry)
          .leftJoin(
            serviceProvider,
            eq(serviceRegistry.providerId, serviceProvider.id),
          )
          .where(eq(serviceRegistry.id, id))
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

        const cfg = await fetchConfig(db, row.serviceType as ServiceType, row.id);

        const cfgWithSecrets = cfg
          ? {
            ...serializeConfig(
              row.serviceType as ServiceType,
              cfg as Record<string, unknown>,
            ),
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
            service_type: row.serviceType,
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

      // Create service
      .post(
        "/services",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const body = ctx.body as {
            name: string;
            description?: string;
            service_type: ServiceType;
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

          const [reg] = await db
            .insert(serviceRegistry)
            .values({
              name: body.name,
              description: body.description ?? null,
              serviceType: body.service_type,
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
            body.service_type,
            reg.id,
            body.config ?? {},
          );

          return {
            success: true as const,
            data: {
              id: reg.id,
              name: reg.name,
              service_type: reg.serviceType,
              organization_id: reg.organizationId,
              team_id: reg.teamId,
              provider_id: reg.providerId,
              is_global: reg.isGlobal,
              is_active: reg.isActive,
              config: serializeConfig(
                body.service_type,
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
            service_type: t.Union(
              SERVICE_TYPES.map((st) => t.Literal(st)),
            ),
            organization_id: t.Optional(t.Number()),
            team_id: t.Optional(t.Number()),
            provider_id: t.Optional(t.Number()),
            is_global: t.Optional(t.Boolean()),
            config: t.Record(t.String(), t.Unknown()),
          }),
        },
      )

      // Update service
      .put(
        "/services/:id",
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
            .from(serviceRegistry)
            .where(eq(serviceRegistry.id, id))
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

          const regUpdates: Partial<typeof serviceRegistry.$inferInsert> = {
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
            .update(serviceRegistry)
            .set(regUpdates)
            .where(eq(serviceRegistry.id, id))
            .returning();

          if (body.config && Object.keys(body.config).length > 0) {
            await patchConfig(
              db,
              existing.serviceType as ServiceType,
              id,
              body.config,
            );
          }

          const cfg = await fetchConfig(
            db,
            existing.serviceType as ServiceType,
            id,
          );

          let provider: { id: number; code: string; display_name: string } | null = null;
          const effectiveProviderId = updated.providerId;
          if (effectiveProviderId) {
            const [prov] = await db
              .select({
                id: serviceProvider.id,
                code: serviceProvider.code,
                displayName: serviceProvider.displayName,
              })
              .from(serviceProvider)
              .where(eq(serviceProvider.id, effectiveProviderId))
              .limit(1);
            if (prov) provider = { id: prov.id, code: prov.code, display_name: prov.displayName };
          }

          return {
            success: true as const,
            data: {
              id: updated.id,
              name: updated.name,
              service_type: updated.serviceType,
              organization_id: updated.organizationId,
              team_id: updated.teamId,
              provider,
              is_global: updated.isGlobal,
              is_active: updated.isActive,
              config: serializeConfig(
                existing.serviceType as ServiceType,
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

      // Delete service (cascades to config via FK)
      .delete("/services/:id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [existing] = await db
          .select()
          .from(serviceRegistry)
          .where(eq(serviceRegistry.id, id))
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
          .delete(serviceRegistry)
          .where(eq(serviceRegistry.id, id));

        return { success: true as const };
      })

      // Test connectivity
      .post("/services/:id/test", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [row] = await db
          .select()
          .from(serviceRegistry)
          .where(eq(serviceRegistry.id, id))
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

        const cfg = await fetchConfig(db, row.serviceType as ServiceType, id);
        if (!cfg) {
          return { success: false as const, error: "No config found" };
        }

        try {
          switch (row.serviceType) {
            case "output.influxdb3": {
              const c = cfg as typeof serviceOutputInfluxdb3Config.$inferSelect;
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
            case "output.http-push": {
              const c = cfg as typeof serviceOutputHttppushConfig.$inferSelect;
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
                error: `Test not supported for type: ${row.serviceType}`,
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
