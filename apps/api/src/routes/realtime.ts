/**
 * Realtime WebSocket route
 *
 * Endpoint: GET /api/realtime?token=<JWT>
 *
 * On connection:
 *   • Validates JWT (same HS256 scheme used by the rest of the API)
 *   • Subscribes to NATS subject `telemetry.raw.{orgId}.>` for the org
 *     derived from the token (or full `telemetry.raw.>` for superAdmins)
 *   • Decodes the proto-encoded IngestRequest, extracts pre_parsed_fields +
 *     timestamp + routing metadata from the NATS subject
 *   • Streams JSON frames: { type: "telemetry", data: { device_key,
 *     organization_id, team_id, fields, ts } }
 *
 * Optional client message:
 *   { action: "subscribe_team", teamId: "<id>" }
 *   Narrows subsequent forwarding to messages from that team.
 */

import { Elysia } from "elysia";
import type { NatsConnection, Subscription } from "nats";
import { validateToken } from "../db/auth";

// ─── Minimal proto wire-format decoder ───────────────────────────────────────
// We only need two fields from IngestRequest:
//   field 2  – google.protobuf.Timestamp  (wire type 2, length-delimited)
//   field 9  – repeated ParsedField       (wire type 2, length-delimited)
//
// ParsedField: field 1 = key (string, wire 2), field 2 = value (double, wire 1)
// Timestamp:   field 1 = seconds (int64, wire 0)

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos] as number;
    pos++;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    // Guard against > 32-bit shift truncation for large int64 varints
    if (shift > 28) {
      // Consume remaining bytes without accumulating (timestamp fits in 31 bits)
      while (pos < buf.length && ((buf[pos] as number) & 0x80) !== 0) { pos++; }
      if (pos < buf.length) pos++; // consume the final byte
      break;
    }
  }
  return [result, pos];
}

function readLenDelim(buf: Uint8Array, pos: number): [Uint8Array, number] {
  const [len, newPos] = readVarint(buf, pos);
  return [buf.subarray(newPos, newPos + len), newPos + len];
}

function skipField(buf: Uint8Array, pos: number, wireType: number): number {
  switch (wireType) {
    case 0: // varint – consume until MSB clear
      while (pos < buf.length && ((buf[pos] as number) & 0x80) !== 0) { pos++; }
      if (pos < buf.length) pos++;
      return pos;
    case 1: // 64-bit fixed
      return pos + 8;
    case 2: { // length-delimited
      const [, after] = readLenDelim(buf, pos);
      return after;
    }
    case 5: // 32-bit fixed
      return pos + 4;
    default:
      return buf.length; // unknown wire type – bail
  }
}

function decodeTimestampSeconds(buf: Uint8Array): number {
  let pos = 0;
  while (pos < buf.length) {
    const [tag, newPos] = readVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNum === 1 && wireType === 0) {
      const [secs, secsPos] = readVarint(buf, pos);
      pos = secsPos;
      return secs;
    }
    pos = skipField(buf, pos, wireType);
  }
  return Math.floor(Date.now() / 1000);
}

function decodeParsedField(
  buf: Uint8Array,
): { key: string; value: number } | null {
  let pos = 0;
  let key = "";
  let value = 0;
  while (pos < buf.length) {
    const [tag, newPos] = readVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNum === 1 && wireType === 2) {
      const [bytes, after] = readLenDelim(buf, pos);
      key = new TextDecoder().decode(bytes);
      pos = after;
    } else if (fieldNum === 2 && wireType === 1) {
      const dv = new DataView(buf.buffer, buf.byteOffset + pos, 8);
      value = dv.getFloat64(0, true);
      pos += 8;
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
  return key ? { key, value } : null;
}

export function decodeIngestPayload(data: Uint8Array): {
  ts: number;
  fields: Record<string, number>;
} {
  let pos = 0;
  let ts = Math.floor(Date.now() / 1000);
  const fields: Record<string, number> = {};

  while (pos < data.length) {
    const [tag, newPos] = readVarint(data, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;

    if (fieldNum === 2 && wireType === 2) {
      // google.protobuf.Timestamp
      const [bytes, after] = readLenDelim(data, pos);
      pos = after;
      ts = decodeTimestampSeconds(bytes);
    } else if (fieldNum === 9 && wireType === 2) {
      // pre_parsed_fields: each occurrence is one ParsedField message
      const [bytes, after] = readLenDelim(data, pos);
      pos = after;
      const field = decodeParsedField(bytes);
      if (field) fields[field.key] = field.value;
    } else {
      pos = skipField(data, pos, wireType);
    }
  }

  return { ts, fields };
}

// ─── Per-connection state ─────────────────────────────────────────────────────

interface ConnState {
  sub?: Subscription;
  orgId: number | null;
  teamId?: string;
}

const connections = new Map<string, ConnState>();

// ─── Route factory ────────────────────────────────────────────────────────────

export function createRealtimeRoutes(nc: NatsConnection | null) {
  return new Elysia({ name: "realtime-routes" }).ws("/api/realtime", {
    open(ws) {
      const raw = ws.data.request.url as string;
      const url = raw.startsWith("http")
        ? new URL(raw)
        : new URL(`http://host${raw}`);
      const token = url.searchParams.get("token");

      if (!token) {
        ws.close();
        return;
      }

      const payload = validateToken(token);
      if (!payload) {
        ws.close();
        return;
      }

      connections.set(ws.id, { orgId: payload.orgId });

      if (!nc || nc.isClosed()) {
        ws.send(
          JSON.stringify({ type: "error", message: "NATS not connected" }),
        );
        return;
      }

      // Scope subscription to this org's telemetry; superAdmins see all
      const subject =
        payload.orgId != null
          ? `telemetry.raw.${payload.orgId}.>`
          : "telemetry.raw.>";

      const sub = nc.subscribe(subject);
      const conn = connections.get(ws.id);
      if (!conn) { ws.close(); return; }
      conn.sub = sub;

      (async () => {
        for await (const msg of sub) {
          const c = connections.get(ws.id);
          if (!c) break;

          // Extract routing from subject: telemetry.raw.{orgId}.{teamId}.{deviceKey}
          const parts = msg.subject.split(".");
          const orgId = Number(parts[2]);
          const teamId = Number(parts[3]);
          const deviceKey = Number(parts[4] ?? 0);

          // Optional team filter applied by client
          if (c.teamId && String(teamId) !== c.teamId) continue;

          try {
            const { ts, fields } = decodeIngestPayload(msg.data);

            ws.send(
              JSON.stringify({
                type: "telemetry",
                data: {
                  device_key: deviceKey,
                  organization_id: orgId,
                  team_id: teamId,
                  fields,
                  ts,
                },
              }),
            );
          } catch {
            /* skip malformed messages */
          }
        }
      })();
    },

    message(ws, message) {
      try {
        const msg = (
          typeof message === "string" ? JSON.parse(message) : message
        ) as Record<string, unknown>;
        if (msg.action === "subscribe_team") {
          const conn = connections.get(ws.id);
          if (conn) conn.teamId = String(msg.teamId);
        }
      } catch {
        /* ignore malformed client messages */
      }
    },

    close(ws) {
      const conn = connections.get(ws.id);
      if (conn?.sub) conn.sub.drain().catch(() => { });
      connections.delete(ws.id);
    },
  });
}
