# CLAUDE.md — zc8 Project Guide

This file provides Claude AI with key facts about the zc8 project to enable efficient assistance.

## Project Overview

**zc8** is an IoT telemetry platform built as a monorepo. Devices publish telemetry → transport adapters ingest it via NATS JetStream → an ingest service fans out to InfluxDB3, Redis, and NATS realtime → the web dashboard subscribes directly to NATS over WebSocket.

---

## Repository Structure

```
apps/
  api/       — Elysia.js / Bun HTTP + NATS control plane (port 3333)
  web/       — Next.js dashboard (port 3000)
  mobile/    — Expo mobile app
  storybook/ — UI component library
packages/    — Shared Go packages (go-data, go-cache, go-config, go-infra, go-parser, go-pipeline, proto)
services/
  input/     — Go input adapters (mqtt, http-server, http-pull, grpc-server, grpc-pull)
  output/    — Go output adapters (mqtt, http-push, grpc-push, influxdb3)
infra/
  docker/    — docker-compose.yaml (single compose for local dev)
  nats/      — nats.conf (JetStream + WebSocket, no auth in local dev)
  postgres/  — migrations/create_tables.sql + seed_tables.sql (auto-run on first start)
```

---

## Tech Stack

| Layer           | Technology                                                        |
| --------------- | ----------------------------------------------------------------- |
| Runtime         | Bun 1.3.2                                                         |
| API framework   | ElysiaJS 1.4.17                                                   |
| ORM             | Drizzle 0.45.1                                                    |
| Frontend        | Next.js 16.2.2, React 19, Tailwind, shadcn/ui                     |
| Database        | PostgreSQL 18 (docker superuser: postgres:postgres / app db: zc8) |
| Messaging       | NATS 2.12.4 (JetStream + WebSocket)                               |
| Time-series     | InfluxDB3                                                         |
| Go services     | Go 1.25.5 (go.work workspace)                                     |
| Package manager | pnpm workspaces (TS) + go.work (Go)                               |

---

## Common Commands

```bash
# Infrastructure (from repo root)
docker compose -f infra/docker/docker-compose.yaml up -d      # Start all services
docker compose -f infra/docker/docker-compose.yaml down -v    # Wipe + stop (re-runs init scripts)

# API (from apps/api)
bun dev                          # Start API with hot reload
bun run db:push                  # Push Drizzle schema directly (no migration files needed)
bun run db:generate              # Drizzle schema → migration files
bun run db:migrate               # Apply pending migrations
bun run scripts/generate-nats-account-key.ts  # Generate NATS NKey account keypair

# Web (from apps/web)
pnpm dev                         # Start Next.js dev server

# Go services (from repo root — DATABASE_URL read from env or uses default)
go run ./services/input/mqtt/cmd/mqtt/             # MQTT input adapter
go run ./services/input/http-server/cmd/http-server/  # HTTP server input
go run ./services/output/influxdb3/cmd/influxdb3/     # InfluxDB3 output
```

---

## Data Flow

```
Device (MQTT/HTTP/gRPC)
  → Input adapter (services/input/*)
  → proto.Marshal(IngestRequest) or JSON
  → NATS JetStream: subject telemetry.raw.{orgId}.{teamId}.{deviceKey}
  → API heartbeat subscription → publishes JSON to telemetry.realtime.*.*.*
  → Browser subscribes directly to NATS via WebSocket (port 4223)
```

---

## Authentication

- **User auth**: Custom JWT HS256, SHA-256 password hashing
  - `echo -n "password" | shasum -a 256`
- **SuperAdmin**: `admin@platform.com` / `admin123`
- **API JWT**: issued by `apps/api/src/db/auth.ts` — `validateToken()`
- **Login returns HTTP 401** on failure (Elysia route uses `set.status = 401`)
- **NATS**: local dev uses no auth (open access). Auth callout is production-only.

---

## Key Environment Variables

### `.env` (repo root)

```
# Docker postgres superuser (default postgres credentials)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_SSLMODE=disable

# Application database (created by init scripts)
POSTGRES_DATABASE=zc8

# Go services connection string
DATABASE_URL=postgres://postgres:postgres@localhost:5432/zc8?sslmode=disable

NATS_URL=nats://localhost:4222
NATS_WS_URL=ws://localhost:4223
JWT_SECRET=...
NATS_ACCOUNT_SEED=...    # Optional: generate with scripts/generate-nats-account-key.ts
NATS_ACCOUNT_PUBKEY=...  # Optional: used only if auth_callout is enabled
NATS_INTERNAL_PASSWORD=...
```

### `apps/web/.env.local`

```
ELYSIA_API_URL=http://localhost:3333
NEXT_PUBLIC_ELYSIA_API_URL=http://localhost:3333
NEXT_PUBLIC_NATS_WS_URL=ws://localhost:4223
```

---

## NATS Architecture

- **Port 4222**: TCP client (Go services + API)
- **Port 4223**: WebSocket (browser direct access via `nats.ws`)
- **Port 8222**: HTTP monitoring
- **Config**: `infra/nats/nats.conf` — no auth in local dev (removed auth_callout to avoid bootstrap deadlock)
- **JetStream**: subjects `telemetry.raw.>`
- **Realtime subject**: `telemetry.realtime.{orgId}.{teamId}.{deviceKey}` (JSON)
- **Browser NATS client**: `apps/web/src/lib/nats-realtime.ts` — `subscribeNatsRealtime()`

---

## Database

- **Docker superuser**: `postgres:postgres` (docker default)
- **App database**: `zc8` — created by `infra/postgres/migrations/create_tables.sql` on first start
- **App user**: `zc8` with password `zc8` — created by init script, used by API code defaults
- **API connects as**: `zc8:zc8` to `zc8` db (hardcoded fallback in `apps/api/src/index.ts`)
- **drizzle-kit connects as**: `postgres:postgres` to `zc8` db (from `.env`)
- **Go services connect as**: `postgres:postgres` to `zc8` db (from `DATABASE_URL` env / default)
- **33 tables** created by `create_tables.sql`, seeded by `seed_tables.sql`
- Drizzle schema: `apps/api/src/db/schema.ts`
- Key Drizzle→DB name mappings: `roles` → `user_roles`, `memberships` → `organization_members`

---

## Go Service Conventions

- All services in `services/input/` and `services/output/`
- Each has `cmd/<name>/main.go` with `loadConfig()` reading from env vars
- Default `DATABASE_URL`: `postgres://postgres:postgres@localhost:5432/zc8?sslmode=disable`
- Default `NATS_URL`: `nats://localhost:4222`
- External deps wrapped in `packages/go-infra` — services must NOT import them directly

---

## Known Issues / Gotchas

- Password hashing is SHA-256 (not bcrypt) throughout the system
- SuperAdmin can log in with null org fields (no org membership required)
- NATS `nkeys.js` v1.1.0 does NOT have a `wipe()` method — omit it
- NATS auth_callout removed from local dev (bootstrap deadlock — API needs NATS to start before it can serve as auth callout handler)
- `apps/api/src/index.ts` loads `.env` from `process.cwd()/.env` (i.e. `apps/api/.env` which doesn't exist), so it falls back to hardcoded `zc8:zc8` — this works because the init script creates the `zc8` user
- Go services do NOT auto-load `.env` — export vars in shell or rely on hardcoded defaults
- `drizzle-kit migrate` hangs with `strict: true` — always use `strict: false`
- `drizzle-kit push/migrate` needs `ssl: false` in `drizzle.config.ts` for local postgres
- `docker compose down -v` is required when changing postgres credentials (wipes volume to re-run init scripts)

---

## Infrastructure Setup (first time)

```bash
# 1. Start infra (auto-creates zc8 db + user + tables + seeds admin user)
cd infra/docker && docker compose up -d
# Verify: docker logs telemetry-postgres --tail=20

# 2. Start API (uses zc8:zc8 defaults — no .env needed)
cd apps/api && bun dev

# 3. Start web
cd apps/web && pnpm dev

# 4. Login
# URL: http://localhost:3000
# Email: admin@platform.com  Password: admin123
```
