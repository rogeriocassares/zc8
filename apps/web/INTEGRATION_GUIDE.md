# Next.js Device Registry Integration

## Overview

This is a complete Next.js integration for the ZC8 Device Registry with:

- **Member-based RBAC** (Organization → Members with roles → Devices)
- **Real-time WebSocket streaming** for device updates
- **Redis last hash values** showing most recent device state
- **Multi-organization support** with tenant isolation
- **Integration with Elysia.js backend** for authentication and device management

## Architecture

```
Next.js Frontend (apps/web)
  ├── Auth Layer
  │   ├── auth-client.ts - API communication
  │   ├── auth-context.tsx - Session management
  │   └── login page
  ├── Device Management
  │   ├── device-context.tsx - Device state + WebSocket
  │   └── devices-table.tsx - UI component
  └── API Routes (proxy to Elysia)
      ├── /api/auth/login
      ├── /api/auth/logout
      ├── /api/auth/me
      ├── /api/auth/switch-org
      └── /api/devices/...

Elysia Backend (apps/api)
  ├── /auth/login - JWT authentication
  ├── /auth/me - Get current user
  ├── /auth/switch-org - Switch organization
  ├── /devices - List devices (multi-tenant filtered)
  ├── /devices/:id/last-update - Redis last hash value
  └── /devices/stream - WebSocket for real-time updates
```

## Authentication Model: Member-Based RBAC

### Hierarchy

```
Organization
  └── Members (with roles: admin, editor, viewer)
      └── Devices (filtered by member's organization)
```

### Roles

- **admin**: Full access - read, write, delete, manage members
- **editor**: Modify access - read, write, update devices
- **viewer**: Read-only access - view devices, data

### Implementation

1. User logs in with email/password
2. Backend verifies credentials in database (device_registry schema)
3. Returns JWT with embedded tenant_id and member_role
4. Frontend stores token in localStorage
5. All API calls include Authorization header
6. Multi-tenant queries automatically filtered by tenant_id

## File Structure

```
apps/web/src/
├── app/
│   ├── layout.tsx - Root layout with AuthProvider
│   ├── page.tsx - Redirect to login/dashboard
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.ts
│   │   │   ├── logout/route.ts
│   │   │   ├── me/route.ts
│   │   │   └── switch-org/route.ts
│   │   └── devices/
│   │       ├── route.ts (list devices)
│   │       └── [id]/last-update/route.ts
│   ├── auth/
│   │   └── login/
│   │       └── page.tsx
│   └── dashboard/
│       └── page.tsx
├── lib/
│   ├── auth-client.ts - API communication layer
│   ├── auth-context.tsx - React Context for auth
│   ├── device-context.tsx - React Context for devices + WebSocket
│   └── types.ts (optional - type definitions)
└── components/
    └── devices-table.tsx - Device listing UI
```

## Installation

### 1. Install Dependencies

```bash
cd apps/web
pnpm install
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
# Edit .env.local with your Elysia backend URLs
```

### 3. Elysia Backend Setup

Ensure the Elysia backend has these endpoints:

- `POST /auth/login` - Returns { userId, email, organizationId, organizationName, role, token, tokenExpires }
- `GET /auth/me` - Returns { id, email, name, organizations: [] }
- `POST /auth/switch-org` - Returns updated session
- `GET /devices` - Returns Device[] filtered by tenant_id
- `GET /devices/:id/last-update` - Returns { hash, value, timestamp }
- `WebSocket /devices/stream` - Real-time device updates

## Key Files Explained

### auth-client.ts

Authentication client that communicates with the backend.

**Key Methods:**

- `login(credentials)` - Authenticate and get session
- `logout()` - Clear session
- `getUserOrganizations()` - Fetch user's organizations
- `switchOrganization(orgId)` - Switch active organization
- `canRead/canWrite/canAdmin()` - Check permissions

### auth-context.tsx

React Context providing session state to entire app.

**Provider Props:**

- `children` - App components

**useAuth() Hook:**

- `session` - Current session (userId, token, role, etc)
- `user` - User data with organizations
- `login()` - Login method
- `logout()` - Logout method
- `switchOrganization()` - Switch org method
- `canRead/canWrite/canAdmin()` - Permission checks

### device-context.tsx

Manages device data and real-time WebSocket connection.

**Features:**

- Fetches devices from `/api/devices`
- Establishes WebSocket connection to `ws://localhost:3001/devices/stream`
- Subscribes/unsubscribes to device updates
- Stores Redis last hash values per device
- Auto-reconnects on disconnect

**useDevices() Hook:**

- `devices` - Current device list
- `deviceUpdates` - Map of device ID → last update
- `wsConnected` - WebSocket connection status
- `fetchDevices()` - Manually refresh device list
- `subscribeToUpdates(deviceId)` - Subscribe to device
- `unsubscribeFromUpdates(deviceId)` - Unsubscribe

**useDeviceUpdates(deviceId) Hook:**

- Subscribes to specific device on mount
- Returns current update for device
- Auto-unsubscribes on unmount

### devices-table.tsx

UI component displaying device table with real-time updates.

**Features:**

- Shows device ID, device key, type, status
- Displays Redis last hash value
- Shows last value from device update
- Real-time status updates via WebSocket
- Visual indicators for status (active/inactive/error)
- Type-specific coloring (LoRaWAN/ZC2X/MQTT/HTTP/Agent)

## Usage

### Starting the App

1. Start Elysia backend:

```bash
cd apps/api
pnpm dev
```

2. Start Next.js frontend:

```bash
cd apps/web
pnpm dev
```

3. Open http://localhost:3000 in browser

### Login Flow

1. User enters credentials (email/password)
2. Click "Sign In"
3. Request sent to `/api/auth/login` → proxied to Elysia
4. Session stored in localStorage
5. Redirected to `/dashboard`
6. Devices loaded from `/api/devices`
7. WebSocket connects for real-time updates

### Organization Switching

1. Select different organization from dropdown
2. POST to `/api/auth/switch-org`
3. New session obtained
4. Device list refreshed (filtered by new org)

### Real-Time Updates

1. WebSocket connects automatically on mount
2. Messages arrive in format:

```json
{
  "type": "device_update",
  "deviceId": "device-123",
  "data": {
    "hash": "abc123def456",
    "value": { "temperature": 25.5 },
    "timestamp": 1708000000000,
    "status": "active"
  }
}
```

3. Frontend updates table with new values
4. Redis hash values displayed in "Last Hash" column

## Backend Integration Requirements

### Database Schema (Device Registry)

Already implemented in Phase 5:

- `device_registry` - Master device record + tenant isolation
- `device_lns` - LoRaWAN devices
- `device_zc2x` - ESP32 devices
- `device_mqtt_gateway` - MQTT devices
- `device_http_gateway` - HTTP webhook devices
- `device_os_agent` - OS agent devices
- `device_integrations` - Multi-instance bridge

### Required Elysia Endpoints

#### Authentication

- `POST /auth/login` - credentials → { token, organizations, role, tenantId }
- `GET /auth/me` - get current user
- `POST /auth/switch-org` - switch tenant context

#### Devices

- `GET /devices` - paginated list of tenant's devices
- `GET /devices/:id` - single device details
- `GET /devices/:id/last-update` - Redis last value
- `WebSocket /devices/stream` - real-time updates

### Redis Setup

Used for storing device last update values (hash/last value):

- Key: `device:{deviceId}:last_update`
- Value: `{ hash, value, timestamp }`

## Security Considerations

### Token Management

- JWT tokens stored in localStorage (consider httpOnly cookies for production)
- Tokens included in Authorization header for all requests
- Backend validates token signature and expiration

### Multi-Tenant Isolation

- All queries filtered by tenant_id from JWT
- Role-based access control (viewer/editor/admin)
- API routes validate authorization header
- WebSocket messages include authorization

### Best Practices

- Use HTTPS in production
- Consider moving tokens to httpOnly cookies
- Implement token refresh mechanism
- Add CSRF protection for sensitive operations
- Validate input on backend
- Rate limit authentication attempts

## Performance Optimization

### Caching Strategy

- Device list cached in React Context
- Redis last updates fetched once per device on mount
- WebSocket provides incremental updates (no full refresh)
- localStorage stores session to avoid re-login

### Expected Performance

- Initial load: ~500-800ms (includes auth + device fetch + WS connect)
- Device update latency: <100ms (Redis to WebSocket)
- Per-device WebSocket message size: <1KB
- Database query time: <50ms (with indexes)

## Troubleshooting

### WebSocket Not Connecting

1. Check `NEXT_PUBLIC_WS_URL` environment variable
2. Ensure Elysia backend WebSocket endpoint exists
3. Check browser DevTools Network tab for connection errors
4. Verify token is being sent in WebSocket headers

### Devices Not Loading

1. Verify JWT token is valid
2. Check Authorization header in API requests
3. Ensure database contains devices for user's organization
4. Check Elysia backend logs for query errors

### Real-Time Updates Not Appearing

1. Confirm WebSocket connection established (status dot should be green)
2. Check browser console for WebSocket errors
3. Verify Redis contains last update values
4. Confirm device is subscribed to in device-context

### Login Fails

1. Check credentials against database user table
2. Verify Elysia `/auth/login` endpoint responds correctly
3. Check CORS configuration on Elysia backend
4. Verify `ELYSIA_API_URL` points to correct backend

## Next Steps

### Phase 2: Device Management

- Create device registration form
- Implement device type-specific fields
- Add device deletion/deactivation
- Device retry configuration UI

### Phase 3: Telemetry Visualization

- Time-series chart component (Recharts/Chart.js)
- Device metrics dashboard
- Alert configuration
- Historical data viewer

### Phase 4: Advanced Features

- Export device data (CSV/JSON)
- Batch device operations
- Device scheduling/automation
- API key management for device access

## References

- [Device Registry v3 Architecture](../DEVICE_REGISTRY_V3_ARCHITECTURE.md)
- [Device Registry Implementation Guide](../DEVICE_REGISTRY_V3_GUIDE.md)
- [Phase 5 Completion Summary](../PHASE_5_COMPLETION_SUMMARY.md)
- [Elysia.js Documentation](https://elysiajs.com)
- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
