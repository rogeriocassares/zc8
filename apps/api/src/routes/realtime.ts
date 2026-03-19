/**
 * Realtime Telemetry Routes
 *
 * WebSocket bridge: authenticates user via JWT, subscribes to NATS Core
 * on their behalf, and forwards messages to the browser.
 *
 * Subject hierarchy: telemetry.realtime.{org_id}.{team_id}.{device_key}
 *
 * Subscriptions based on authenticated user's organization:
 *   - org-wide:  telemetry.realtime.{org_id}.>
 *   - team:      telemetry.realtime.{org_id}.{team_id}.>
 *   - device:    telemetry.realtime.{org_id}.{team_id}.{device_key}
 */

import { Elysia } from "elysia";
import {
  type NatsConnection,
  connect as natsConnect,
  StringCodec,
  type Subscription,
} from "nats";

const NATS_URL = process.env.NATS_URL || "nats://localhost:4222";
const sc = StringCodec();

// Shared NATS connection (lazy singleton)
let natsConn: NatsConnection | null = null;

async function getNatsConnection(): Promise<NatsConnection> {
  if (natsConn && !natsConn.isClosed()) {
    return natsConn;
  }
  natsConn = await natsConnect({ servers: NATS_URL });
  console.log("[realtime] Connected to NATS:", NATS_URL);
  return natsConn;
}

// JWT validation (same as UserJWTHandler in index.ts)
function validateUserToken(
  token: string,
  signingKey: string,
): {
  userId: string;
  organizationId: bigint;
  teamId?: bigint;
  memberRole: string;
} | null {
  try {
    const crypto = require("crypto");
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    if (signature !== signatureB64) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      userId: payload.userId,
      organizationId: BigInt(payload.organizationId),
      teamId: payload.teamId ? BigInt(payload.teamId) : undefined,
      memberRole: payload.memberRole,
    };
  } catch {
    return null;
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "";

export function createRealtimeRoutes() {
  return new Elysia().ws("/api/realtime", {
    open(ws) {
      // Auth from query param (WebSocket can't send headers)
      const url = new URL(ws.data.request.url);
      const token = url.searchParams.get("token");
      if (!token) {
        ws.send(JSON.stringify({ error: "Missing token" }));
        ws.close();
        return;
      }

      const user = validateUserToken(token, JWT_SECRET);
      if (!user) {
        ws.send(JSON.stringify({ error: "Invalid or expired token" }));
        ws.close();
        return;
      }

      // Store user context on ws.data
      (ws.data as any).user = user;
      (ws.data as any).subscriptions = new Map<string, Subscription>();

      // Auto-subscribe to org-wide realtime
      const subject = `telemetry.realtime.${user.organizationId}.>`;
      subscribeToNats(ws, subject);

      ws.send(
        JSON.stringify({
          type: "connected",
          organizationId: user.organizationId.toString(),
          subject,
        }),
      );
    },

    async message(ws, rawMessage) {
      const user = (ws.data as any).user;
      if (!user) return;

      let msg: { action?: string; teamId?: string; deviceKey?: string };
      try {
        msg =
          typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
      } catch {
        return;
      }

      const subs = (ws.data as any).subscriptions as Map<string, Subscription>;

      if (msg.action === "subscribe_team" && msg.teamId) {
        const subject = `telemetry.realtime.${user.organizationId}.${msg.teamId}.>`;
        subscribeToNats(ws, subject);
      } else if (msg.action === "subscribe_device" && msg.deviceKey) {
        // Scoped to org — user can only subscribe within their org
        const subject = `telemetry.realtime.${user.organizationId}.*.${msg.deviceKey}`;
        subscribeToNats(ws, subject);
      } else if (msg.action === "unsubscribe" && msg.teamId) {
        const subject = `telemetry.realtime.${user.organizationId}.${msg.teamId}.>`;
        const sub = subs.get(subject);
        if (sub) {
          sub.unsubscribe();
          subs.delete(subject);
        }
      }
    },

    close(ws) {
      const subs = (ws.data as any)?.subscriptions as
        | Map<string, Subscription>
        | undefined;
      if (subs) {
        for (const sub of subs.values()) {
          sub.unsubscribe();
        }
        subs.clear();
      }
    },
  });
}

async function subscribeToNats(ws: any, subject: string) {
  try {
    const nc = await getNatsConnection();
    const subs = (ws.data as any).subscriptions as Map<string, Subscription>;

    // Don't duplicate subscriptions
    if (subs.has(subject)) return;

    const sub = nc.subscribe(subject, {
      callback: (_err, msg) => {
        if (_err) return;
        try {
          const data = sc.decode(msg.data);
          ws.send(
            JSON.stringify({
              type: "telemetry",
              subject: msg.subject,
              data: JSON.parse(data),
            }),
          );
        } catch {
          // Skip malformed messages
        }
      },
    });

    subs.set(subject, sub);
  } catch (err) {
    console.error("[realtime] NATS subscribe error:", err);
  }
}
