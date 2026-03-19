# Quick Start Guide - Next.js Device Registry

## 30-Second Overview

A production-ready Next.js dashboard that integrates with the Elysia backend for:

- **Member-based authentication** (email/password → JWT token)
- **Organizational device management** (multi-tenant isolation)
- **Real-time device updates** (WebSocket streaming)
- **Redis last values** (device telemetry hash)

## Installation (5 minutes)

```bash
# 1. Install dependencies
cd apps/web
pnpm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit .env.local with your URLs

# 3. Start development server
pnpm dev
```

Visit http://localhost:3000

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js Frontend (Port 3000)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  login/page.tsx  ──auth──┐                                       │
│                          └──→ AuthContext (JWT Token)            │
│                               ↓                                  │
│  dashboard/page.tsx ──────────→ useAuth() Hook                  │
│       ↓                         ├─ session (token, role, org)   │
│  DevicesTable ─────────────────→ ├─ login/logout               │
│       ↓                         ├─ canRead/canWrite/canAdmin   │
│  device-context ─────────────→ └─ switchOrganization()        │
│  (WebSocket)                                                    │
│       ↓                                                          │
└─────────────────────────────────────────────────────────────────┘
           ↓
    ┌──────────────────────────────────┐
    │   Next.js API Routes (Port 3000) │
    ├──────────────────────────────────┤
    │ • /api/auth/login                │
    │ • /api/auth/logout               │
    │ • /api/auth/me                   │
    │ • /api/auth/switch-org           │
    │ • /api/devices                   │
    │ • /api/devices/[id]/last-update  │
    └──────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────┐
│              Elysia Backend (Port 3001)                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  HTTP:                           WebSocket:                      │
│  • POST /auth/login             • /devices/stream (real-time)   │
│  • GET /auth/me                 • Broadcasts device updates      │
│  • POST /auth/switch-org        • Redis last values              │
│  • GET /devices (tenant-filtered)                               │
│  • GET /devices/:id/last-update                                 │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│           PostgreSQL + Redis                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  PostgreSQL:                    Redis:                           │
│  • device_registry (master)     • device:{id}:last_update       │
│  • device_lns (LoRaWAN)         • Stores: { hash, value }      │
│  • device_zc2x (ESP32)                                          │
│  • device_mqtt_gateway (MQTT)   WebSocket Broadcasts:           │
│  • device_http_gateway (HTTP)   • type: "device_update"         │
│  • device_os_agent (Agent)      • deviceId, hash, value        │
│  • device_integrations (bridge) • timestamp                     │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Authentication Flow

```
┌──────────────┐
│   User Login │
│   page.tsx   │
└─────┬────────┘
      │ email, password, orgId
      ↓
┌──────────────────────────┐
│  /api/auth/login/route   │ (Next.js)
└─────┬────────────────────┘
      │ proxy
      ↓
┌──────────────────────────┐
│  POST /auth/login        │ (Elysia)
└─────┬────────────────────┘
      │ validate in DB
      ↓
┌──────────────────────────┐
│  Returns JWT + session   │
│  { token, role, orgId }  │
└─────┬────────────────────┘
      │
      ↓
┌─────────────────────────┐
│  localStorage.setItem   │ (session stored)
│  'auth_session'         │
└─────┬───────────────────┘
      │
      ↓
┌──────────────┐
│  Dashboard   │ (redirected from /auth/login)
│  (protected) │
└──────────────┘
```

## Device Update Flow (Real-Time)

```
1. Device sends telemetry
   └────→ Elysia Backend /ingest/v1/data

2. Backend stores in Redis
   └────→ device:{id}:last_update = { hash, value, timestamp }

3. WebSocket broadcasts to subscribers
   ┌─────────────────────────────────┐
   │ {                               │
   │   type: "device_update",        │
   │   deviceId: "device-123",       │
   │   data: {                       │
   │     hash: "abc123def456",       │
   │     value: { temp: 25.5 },      │
   │     timestamp: 1708000000000,   │
   │     status: "active"            │
   │   }                             │
   │ }                               │
   └─────────────────────────────────┘

4. Frontend receives message
   └────→ device-context.tsx ws.onmessage

5. Update React state
   └────→ setDeviceUpdates(new Map)

6. Table re-renders
   └────→ shows new hash + value + timestamp
```

## Key Components

### 1. AuthProvider (auth-context.tsx)

Wraps entire app, provides session state.

```tsx
<AuthProvider>
  <App />
</AuthProvider>;

// In component:
const { session, login, logout, canWrite } = useAuth();
```

**Returns:**

- `session` - { token, role, organizationId, ... }
- `user` - { id, email, organizations: [] }
- `login(email, password, orgId?)`
- `logout()`
- `canRead()`, `canWrite()`, `canAdmin()`

### 2. DeviceProvider (device-context.tsx)

Manages device list and WebSocket connection.

```tsx
<DeviceProvider>
  <Dashboard />
</DeviceProvider>;

// In component:
const { devices, deviceUpdates, wsConnected, fetchDevices } = useDevices();
const update = useDeviceUpdates(deviceId);
```

**Returns:**

- `devices` - Device[]
- `deviceUpdates` - Map<deviceId, { hash, value, timestamp }>
- `wsConnected` - boolean
- `fetchDevices()` - manual refresh
- `subscribeToUpdates(deviceId)` - subscribe hook

### 3. DevicesTable (devices-table.tsx)

Displays devices with real-time updates.

```tsx
<DevicesTable />
```

Columns:

- Device ID
- Device Key
- Type (LoRaWAN/ZC2X/MQTT/HTTP/Agent)
- Status (Active/Inactive/Error)
- Redis Last Hash (SHA hash of last value)
- Last Value (most recent telemetry)
- Updated (timestamp)

## File Overview

| File                           | Purpose                      | Lines |
| ------------------------------ | ---------------------------- | ----- |
| `lib/auth-client.ts`           | API client for auth          | ~150  |
| `lib/auth-context.tsx`         | React Context (session)      | ~80   |
| `lib/device-context.tsx`       | React Context (devices + WS) | ~220  |
| `app/auth/login/page.tsx`      | Login page UI                | ~120  |
| `app/dashboard/page.tsx`       | Main dashboard               | ~150  |
| `components/devices-table.tsx` | Device table UI              | ~200  |
| `app/api/auth/*/route.ts`      | Auth API routes              | ~150  |
| `app/api/devices/*/route.ts`   | Device API routes            | ~90   |

**Total: ~1,200 lines**

## Environment Setup

```bash
# .env.local
ELYSIA_API_URL=http://localhost:3001
ELYSIA_WS_URL=ws://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

## Running the App

### Terminal 1: Elysia Backend

```bash
cd apps/api
pnpm dev
# Listening on http://localhost:3001
```

### Terminal 2: Next.js Frontend

```bash
cd apps/web
pnpm dev
# Listening on http://localhost:3000
```

### Terminal 3 (Optional): PostgreSQL

```bash
# Ensure PostgreSQL running on localhost:5432
# Database: zc8
# User: postgres
# Password: postgres
```

### Terminal 4 (Optional): Redis

```bash
# Ensure Redis running on localhost:6379
redis-cli ping
# PONG
```

## Test Credentials

Configure in Elysia backend (check `/auth/login` endpoint):

```
Email: demo@example.com
Password: password123
Organization: (auto-selected or specify)
```

After login:

- Navigate to `/dashboard`
- See devices table with real-time updates
- Switch organizations (if available)
- Logout returns to login page

## Permissions

Based on member role in organization:

| Role   | Read | Write | Delete | Admin |
| ------ | ---- | ----- | ------ | ----- |
| viewer | ✓    | ✗     | ✗      | ✗     |
| editor | ✓    | ✓     | ✗      | ✗     |
| admin  | ✓    | ✓     | ✓      | ✓     |

```tsx
// Check permissions
const { canRead, canWrite, canAdmin } = useAuth();

if (canWrite("devices")) {
  // Show edit button
}
```

## Troubleshooting

### Login doesn't work

- [ ] Elysia backend running on :3001?
- [ ] `/api/auth/login` endpoint exists?
- [ ] Database has users?
- [ ] Check ELYSIA_API_URL in .env.local

### Devices not showing

- [ ] Logged in successfully?
- [ ] Database has devices?
- [ ] Devices belong to user's organization?
- [ ] Column tenant_id matches session.organizationId?

### Real-time updates not appearing

- [ ] WebSocket status = green (connected)?
- [ ] Redis running on :6379?
- [ ] Backend broadcasting updates?
- [ ] Browser console shows errors?

### CORS errors

- [ ] Check Elysia CORS configuration
- [ ] Ensure /api proxy headers correct
- [ ] Frontend making requests to proxy, not direct backend

## Performance Tips

1. **Pagination** - Currently loads all devices. Add pagination for >1000 devices:

```tsx
const [page, setPage] = useState(0);
const res = await fetch(`/api/devices?limit=50&offset=${page * 50}`);
```

2. **Lazy Load Updates** - Only subscribe to visible devices:

```tsx
// Only load updates for devices in viewport
const visibleDevices = devices.filter((d) => isInViewport(d));
visibleDevices.forEach((d) => subscribeToUpdates(d.id));
```

3. **Cache** - Use SWR or React Query for better caching:

```tsx
import useSWR from "swr";
const { data, error } = useSWR("/api/devices", fetcher);
```

## Next Features

- [ ] Device registration form
- [ ] Device deletion/deactivation
- [ ] Telemetry charts (Recharts)
- [ ] Device filtering/search
- [ ] Batch operations
- [ ] Export to CSV/JSON
- [ ] Mobile responsive
- [ ] Dark/light theme toggle
- [ ] Device scheduling
- [ ] Alert management

## Documentation

- **Full Guide:** [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)
- **Implementation Summary:** [NEXT_JS_IMPLEMENTATION_SUMMARY.md](./NEXT_JS_IMPLEMENTATION_SUMMARY.md)
- **Device Registry v3:** [../DEVICE_REGISTRY_V3_ARCHITECTURE.md](../DEVICE_REGISTRY_V3_ARCHITECTURE.md)
- **Elysia API:** [../apps/api/src/index.ts](../apps/api/src/index.ts)
