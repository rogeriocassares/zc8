/**
 * Browser NATS client — direct connection via nats.ws
 *
 * Architecture:
 *   Browser  →  ws://nats-host:4223  →  NATS server
 *                                           ↕ auth callout
 *                                        API (validates JWT, issues scoped
 *                                             NATS User JWT with subscribe
 *                                             permissions for telemetry.realtime.{orgId}.>)
 *
 * The browser authenticates with its API JWT as a bearer token.
 * The NATS auth callout service (in the API) validates the JWT and issues
 * a scoped NATS credential before the WS handshake completes.
 *
 * Published subjects (from API fanout on telemetry.raw.* decode):
 *   telemetry.realtime.{orgId}.{teamId}.{deviceKey}
 *
 * Message payload (JSON):
 *   { device_key: number, organization_id: number, team_id: number,
 *     fields: Record<string, number>, ts: number }
 *
 * Connection pool:
 *   All subscribers with the same (wsUrl, token) share a single NATS WS
 *   connection. This eliminates the auth-callout round-trip per tab/panel.
 */

import type { NatsConnection, Subscription } from "nats.ws";
import { connect, tokenAuthenticator } from "nats.ws";

// ─── Connection pool ──────────────────────────────────────────────────────────

interface PoolEntry {
  nc: NatsConnection;
  refs: number;
}

// Key: `${wsUrl}::${token}` — one connection per unique (server, identity) pair
const connectionPool = new Map<string, PoolEntry>();
// In-flight connection promises — prevents duplicate concurrent connects
const pendingConnections = new Map<string, Promise<NatsConnection>>();

function poolKey(wsUrl: string, token: string): string {
  return `${wsUrl}::${token}`;
}

/**
 * Acquire a shared NATS connection for (wsUrl, token).
 * Increments the ref-count so the connection stays open as long as any
 * subscriber is alive.  Call releaseConnection() in the cleanup path.
 */
async function acquireConnection(
  wsUrl: string,
  token: string,
): Promise<NatsConnection> {
  const key = poolKey(wsUrl, token);

  // Return existing open connection
  const existing = connectionPool.get(key);
  if (existing && !existing.nc.isClosed()) {
    existing.refs++;
    return existing.nc;
  }
  // Remove stale entry (closed connection)
  connectionPool.delete(key);

  // Wait for an in-flight connect attempt (same key)
  const pending = pendingConnections.get(key);
  if (pending) {
    const nc = await pending;
    const entry = connectionPool.get(key);
    if (entry) entry.refs++;
    return nc;
  }

  // Open a new connection
  const promise = connect({
    servers: [wsUrl],
    authenticator: tokenAuthenticator(token),
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  })
    .then((nc) => {
      connectionPool.set(key, { nc, refs: 1 });
      pendingConnections.delete(key);
      // Remove pool entry when the connection is permanently closed
      nc.closed().then(() => connectionPool.delete(key));
      return nc;
    })
    .catch((err) => {
      pendingConnections.delete(key);
      throw err;
    });

  pendingConnections.set(key, promise);
  return promise;
}

/**
 * Decrement the ref-count for (wsUrl, token).
 * Closes the underlying NATS connection when the last subscriber is gone.
 */
function releaseConnection(wsUrl: string, token: string): void {
  const key = poolKey(wsUrl, token);
  const entry = connectionPool.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    connectionPool.delete(key);
    entry.nc.close().catch(() => { });
  }
}

export type TelemetryEvent = {
  device_key: number;
  organization_id: number;
  team_id: number;
  fields: Record<string, number>;
  ts: number; // Unix seconds
};

export type HeartbeatEvent = {
  event_type: "heartbeat" | "tombstone";
  service_id: number;
  service_type: string;
  org_id: number;
  team_id: number;
  team_name: string;
  is_connected?: boolean;
  is_running?: boolean;
  message_count: number;
  error_count: number;
  last_message_at: string;
  reported_at: string;
  broker?: string;
  topics?: string[];
};

export type RawIngestEvent = {
  event_type: "raw_ingest";
  device_key: number;
  organization_id: number;
  team_id: number;
  service_id: number;
  service_type: string;
  topic: string;
  payload_hex: string;
  payload_size: number;
  ts: number;
};

export type OutputAckEvent = {
  event_type: "output_ack";
  service_id: number;
  service_type: string;
  org_id: number;
  team_id: number;
  device_key?: number;
  count: number;
  ts: number;
};

/**
 * Controls which NATS subjects/events are processed.
 *  "all"         — subscribe org-wide; dispatch all event types
 *  "telemetry"   — subscribe org/team-scoped; dispatch only decoded telemetry (legacy)
 *  "heartbeat"   — subscribe heartbeat sub-tree only (legacy)
 *  "device"      — subscribe org/team-scoped; dispatch only plain decoded telemetry
 *  "application" — subscribe org/team-scoped; dispatch only plain decoded telemetry (sensor values)
 *  "integration" — subscribe org-wide; dispatch heartbeats + raw_ingest + output_ack only
 */
export type NatsSubjectMode = "all" | "telemetry" | "heartbeat" | "device" | "application" | "integration";

export type NatsRealtimeOptions = {
  /** WebSocket URL of the NATS server, e.g. ws://localhost:4223 */
  wsUrl: string;
  /** API JWT used as bearer token for NATS auth callout */
  token: string;
  /** Organization ID — subscribes to telemetry.realtime.{orgId}.>
   *  Pass null for superAdmin (subscribes to all orgs: telemetry.realtime.>) */
  orgId: number | null;
  /** Optional team filter — narrows to telemetry.realtime.{orgId}.{teamId}.> */
  teamId?: number | null;
  /**
   * When set, only heartbeat / raw_ingest / output_ack events whose
   * service_id equals this value are dispatched.  Plain telemetry events
   * (no event_type) are always forwarded regardless of this filter.
   */
  serviceId?: number | null;
  /** Controls which NATS subjects to subscribe to. Default "all". */
  mode?: NatsSubjectMode;
  onMessage: (event: TelemetryEvent) => void;
  onHeartbeat?: (event: HeartbeatEvent) => void;
  onRawIngest?: (event: RawIngestEvent) => void;
  onOutputAck?: (event: OutputAckEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

/**
 * Connect to NATS directly from the browser and subscribe to realtime telemetry.
 * Multiple callers with the same (wsUrl, token) share ONE underlying NATS WS
 * connection — eliminating duplicate auth-callout round-trips on tab switch.
 * Returns a cleanup function that unsubscribes and releases the shared connection.
 */
export async function subscribeNatsRealtime(
  opts: NatsRealtimeOptions,
): Promise<() => void> {
  const {
    wsUrl,
    token,
    orgId,
    teamId,
    serviceId,
    mode = "all",
    onMessage,
    onHeartbeat,
    onRawIngest,
    onOutputAck,
    onConnected,
    onDisconnected,
  } = opts;

  let nc: NatsConnection | null = null;
  let sub: Subscription | null = null;
  let acquired = false;
  let cleanedUp = false; // guard against onDisconnected after intentional cleanup

  try {
    nc = await acquireConnection(wsUrl, token);
    acquired = true;

    // If the connection was already open (ref-count > 1), fire onConnected immediately.
    // If it just opened, it fires from the same path — either way the panel sees
    // "connected" without waiting for a second auth callout.
    onConnected?.();

    // Notify the panel when this connection permanently closes (network failure
    // after unlimited reconnect attempts — effectively never in practice).
    nc.closed().then(() => {
      if (!cleanedUp) onDisconnected?.();
    });

    // Build subject based on mode and org/team scope.
    // - "heartbeat" mode: subscribe only to heartbeat sub-tree
    // - "integration" mode: subscribe org-wide to capture heartbeats + output_ack
    // - other modes: subscribe team-scoped if teamId provided, otherwise org-wide
    let subject: string;
    if (mode === "heartbeat") {
      subject =
        orgId == null
          ? `telemetry.realtime.>`
          : `telemetry.realtime.${orgId}.heartbeat.>`;
    } else if (mode === "integration") {
      // Integration needs org-wide: heartbeats come from .heartbeat.* and output_ack from .output.*
      subject =
        orgId == null
          ? `telemetry.realtime.>`
          : `telemetry.realtime.${orgId}.>`;
    } else {
      subject =
        orgId == null
          ? `telemetry.realtime.>`
          : teamId != null
            ? `telemetry.realtime.${orgId}.${teamId}.>`
            : `telemetry.realtime.${orgId}.>`;
    }

    sub = nc.subscribe(subject);

    // Process messages in the background
    (async () => {
      for await (const msg of sub!) {
        try {
          const raw = JSON.parse(
            new TextDecoder().decode(msg.data),
          ) as TelemetryEvent | HeartbeatEvent | RawIngestEvent | OutputAckEvent;
          const eventType = (raw as { event_type?: string }).event_type;
          if (eventType === "heartbeat" || eventType === "tombstone") {
            // Dispatch heartbeats to all modes except pure-telemetry modes
            if (mode !== "telemetry" && mode !== "device" && mode !== "application") {
              const hb = raw as HeartbeatEvent;
              if (serviceId == null || hb.service_id === serviceId) {
                onHeartbeat?.(hb);
              }
            }
          } else if (eventType === "raw_ingest") {
            // Raw ingest events: show in "all" and "integration" modes
            if (mode === "all" || mode === "integration") {
              const ri = raw as RawIngestEvent;
              if (serviceId == null || ri.service_id === serviceId) {
                onRawIngest?.(ri);
              }
            }
          } else if (eventType === "output_ack") {
            // Output ack events: show in "all" and "integration" modes
            if (mode === "all" || mode === "integration") {
              const oa = raw as OutputAckEvent;
              if (serviceId == null || oa.service_id === serviceId) {
                onOutputAck?.(oa);
              }
            }
          } else {
            // Plain decoded telemetry (no event_type)
            if (mode !== "heartbeat" && mode !== "integration") {
              onMessage(raw as TelemetryEvent);
            }
          }
        } catch {
          /* skip malformed */
        }
      }
    })();
  } catch (err) {
    console.warn("[nats-realtime] Connection failed:", err);
    if (acquired) releaseConnection(wsUrl, token);
    onDisconnected?.();
  }

  // Return cleanup function — unsubscribes and releases the shared connection
  return () => {
    cleanedUp = true;
    sub?.unsubscribe();
    if (acquired) releaseConnection(wsUrl, token);
  };
}
