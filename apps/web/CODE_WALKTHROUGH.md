# Code Walkthrough - Next.js Integration

## Overview

This document walks through the key code patterns used in the Next.js integration.

## 1. Authentication Setup

### Initial Entry (app/layout.tsx)

```tsx
import { AuthProvider } from "@/lib/auth-context";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

**What it does:**

- Wraps entire app in AuthProvider
- Makes `useAuth()` hook available everywhere
- Loads stored session from localStorage on mount

### Using Auth in Components

```tsx
import { useAuth } from "@/lib/auth-context";

export default function Dashboard() {
  const { session, user, login, logout, canWrite } = useAuth();

  if (!session) {
    return <p>Not logged in</p>;
  }

  return (
    <div>
      <h1>Welcome, {session.email}</h1>
      <p>Organization: {session.organizationName}</p>
      <p>Role: {session.memberRole}</p>

      {canWrite("devices") && <button>Add Device</button>}
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

**Available methods:**

- `session.token` - JWT token for API calls
- `session.organizationId` - Tenant ID
- `session.memberRole` - Role (admin/editor/viewer)
- `login(email, password, orgId?)` - Authenticate
- `logout()` - Clear session
- `canRead(resource)` - Check read permission
- `canWrite(resource)` - Check write permission
- `canAdmin()` - Check admin permission

---

## 2. Device Management

### Setting Up Device Context

```tsx
import { DeviceProvider } from "@/lib/device-context";
import { DevicesTable } from "@/components/devices-table";

export default function Dashboard() {
  return (
    <DeviceProvider>
      <DevicesTable />
    </DeviceProvider>
  );
}
```

**What it does:**

- Initializes device state management
- Establishes WebSocket connection
- Makes `useDevices()` hook available

### Using Devices in Components

```tsx
import { useDevices, useDeviceUpdates } from "@/lib/device-context";

export default function DeviceCard({ deviceId }) {
  const { devices, deviceUpdates } = useDevices();
  const update = useDeviceUpdates(deviceId); // Auto-subscribes to this device

  const device = devices.find((d) => d.id === deviceId);

  if (!device) return <p>Device not found</p>;

  return (
    <div>
      <h2>{device.id}</h2>
      <p>Status: {device.status}</p>

      {update && (
        <>
          <p>Last Hash: {update.lastHash}</p>
          <p>Last Value: {JSON.stringify(update.lastValue)}</p>
          <p>Updated: {new Date(update.timestamp).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}
```

**Auto-subscription:**

- `useDeviceUpdates(deviceId)` automatically subscribes on mount
- Auto-unsubscribes on unmount
- Returns `{ lastHash, lastValue, timestamp, updatedAt }`

---

## 3. Real-Time Updates (WebSocket)

### How It Works

**device-context.tsx** establishes WebSocket connection:

```tsx
const connectWebSocket = () => {
  const ws = new WebSocket(`${WS_BASE}/devices/stream`, [
    "authorization",
    `Bearer ${session.token}`,
  ]);

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "device_update") {
      const { deviceId, data } = message;

      // Update state with new value
      setDeviceUpdates((prev) => {
        const updated = new Map(prev);
        updated.set(deviceId, {
          deviceId,
          lastHash: data.hash,
          lastValue: data.value,
          timestamp: data.timestamp,
          updatedAt: new Date(data.timestamp).toISOString(),
        });
        return updated;
      });
    }
  };

  ws.onclose = () => {
    // Auto-reconnect after 3 seconds
    setTimeout(connectWebSocket, 3000);
  };
};
```

**Expected message format from Elysia backend:**

```json
{
  "type": "device_update",
  "deviceId": "device-123",
  "data": {
    "hash": "abc123def456",
    "value": {
      "temperature": 25.5,
      "humidity": 60
    },
    "timestamp": 1708000000000,
    "status": "active"
  }
}
```

### In UI Component

```tsx
// Automatically re-renders when update arrives
export function DeviceRow({ deviceId }) {
  const update = useDeviceUpdates(deviceId);

  return (
    <tr>
      <td>{deviceId}</td>
      <td className={update ? "bg-green-100" : "bg-yellow-100"}>
        {update?.lastHash || "-"}
      </td>
      <td>{JSON.stringify(update?.lastValue)}</td>
      <td>{update?.updatedAt}</td>
    </tr>
  );
}
```

---

## 4. API Routes (Next.js)

### Login Route Example

**app/api/auth/login/route.ts:**

```tsx
import { NextRequest, NextResponse } from "next/server";

const ELYSIA_API = process.env.ELYSIA_API_URL || "http://localhost:3001";

export async function POST(request: NextRequest) {
  try {
    const { email, password, organizationId } = await request.json();

    // Call Elysia backend
    const response = await fetch(`${ELYSIA_API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        organizationId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { message: error.message || "Authentication failed" },
        { status: response.status },
      );
    }

    // Transform response
    const session = await response.json();
    return NextResponse.json({
      userId: session.userId,
      email: session.email,
      organizationId: session.organizationId,
      organizationName: session.organizationName,
      memberRole: session.role,
      token: session.token,
      tokenExpires: session.tokenExpires,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
```

**Pattern:** HTTP request → Elysia backend → Transform response → Return

### Protected API Route Pattern

**app/api/devices/route.ts:**

```tsx
export async function GET(request: NextRequest) {
  try {
    // Extract Authorization header
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Forward to Elysia with auth
    const response = await fetch(`${ELYSIA_API}/devices?limit=100&offset=0`, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: "Failed to fetch devices" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
```

**Pattern:** Verify auth header → Forward to Elysia → Return response

---

## 5. Frontend API Access

### Making Authenticated Requests

```tsx
async function getDevices() {
  const res = await fetch("/api/devices", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res.json();
}
```

### Full Flow with Auth Context

```tsx
import { useAuth } from "@/lib/auth-context";

export function MyComponent() {
  const { session } = useAuth();

  const handleFetchDevices = async () => {
    if (!session?.token) {
      console.error("Not authenticated");
      return;
    }

    try {
      const res = await fetch("/api/devices", {
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      if (!res.ok && res.status === 401) {
        // Token expired, logout
        console.error("Session expired");
        return;
      }

      const devices = await res.json();
      console.log("Devices:", devices);
    } catch (error) {
      console.error("Failed to fetch devices:", error);
    }
  };

  return <button onClick={handleFetchDevices}>Fetch Devices</button>;
}
```

---

## 6. Login Form Example

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Call login from auth context
      await login(email, password);

      // Redirect on success
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      {error && <p style={{ color: "red" }}>{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
```

---

## 7. Permission Checks

### In Components

```tsx
import { useAuth } from "@/lib/auth-context";

export function DeviceActions() {
  const { canRead, canWrite, canAdmin } = useAuth();

  return (
    <div>
      {canRead("devices") && <button>View Devices</button>}
      {canWrite("devices") && <button>Add Device</button>}
      {canAdmin() && <button>Manage Users</button>}
    </div>
  );
}
```

### Custom Hook Pattern

```tsx
export function usePermission(resource: string) {
  const { session } = useAuth();

  return {
    canRead: () => !!session,
    canWrite: () => ["admin", "editor"].includes(session?.memberRole),
    canDelete: () => session?.memberRole === "admin",
  };
}

// Usage
export function DeviceItem() {
  const perms = usePermission("devices");

  return (
    <div>
      {perms.canRead() && <span>Device 123</span>}
      {perms.canWrite() && <button>Edit</button>}
      {perms.canDelete() && <button>Delete</button>}
    </div>
  );
}
```

---

## 8. Organization Switching

```tsx
import { useAuth } from "@/lib/auth-context";

export function OrgSwitcher() {
  const { user, session, switchOrganization } = useAuth();

  if (!user?.organizations.length) {
    return null;
  }

  return (
    <select
      value={session?.organizationId}
      onChange={(e) => switchOrganization(e.target.value)}
    >
      {user.organizations.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
```

---

## 9. Error Handling Pattern

```tsx
async function fetchDevices() {
  try {
    const res = await fetch("/api/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Unauthorized - token expired or invalid
        await logout();
        throw new Error("Session expired");
      } else if (res.status === 403) {
        // Forbidden - user doesn't have permission
        throw new Error("Access denied");
      } else if (res.status === 404) {
        // Not found
        throw new Error("Devices not found");
      } else {
        // Other errors
        throw new Error(`HTTP ${res.status}`);
      }
    }

    return await res.json();
  } catch (error) {
    console.error("Failed to fetch devices:", error);
    // Show error to user
    setError(error.message);
  }
}
```

---

## 10. Summary

### Key Patterns

| Pattern                | Usage                                        |
| ---------------------- | -------------------------------------------- |
| `useAuth()`            | Get session, login/logout, check permissions |
| `useDevices()`         | Get device list, device updates, WS status   |
| `useDeviceUpdates(id)` | Subscribe to single device updates           |
| API routes             | Proxy to Elysia with auth                    |
| WebSocket              | Real-time device updates                     |
| localStorage           | Session persistence                          |
| Contexts               | Global state (auth + devices)                |

### Component Hierarchy

```
RootLayout (with AuthProvider)
  ├── page.tsx (redirect to login/dashboard)
  ├── auth/login/page.tsx (login form)
  └── dashboard/page.tsx (with DeviceProvider)
      └── DevicesTable (uses useDevices + useDeviceUpdates)
          ├── DeviceRow (real-time updates)
          └── OrgSwitcher (useAuth)
```

### Data Flow

1. **Authentication:**
   - Form → POST /api/auth/login → Elysia /auth/login
   - Response → localStorage → AuthContext → useAuth() hook

2. **Device Listing:**
   - Mount → fetchDevices() → GET /api/devices → Elysia /devices
   - Response → DeviceContext → useDevices() hook → DevicesTable

3. **Real-Time Updates:**
   - WebSocket connects → Subscribe device IDs
   - Device sends data → Elysia broadcasts → ws.onmessage
   - Update state → React re-renders component

---

## Common Mistakes to Avoid

❌ **Forgetting AuthProvider**

```tsx
// WRONG
<App /> // useAuth() won't work
```

✅ **Correct**

```tsx
<AuthProvider>
  <App />
</AuthProvider>
```

---

❌ **Missing Authorization header**

```tsx
// WRONG
const res = await fetch("/api/devices");
```

✅ **Correct**

```tsx
const res = await fetch("/api/devices", {
  headers: { Authorization: `Bearer ${token}` },
});
```

---

❌ **Not checking session before using**

```tsx
// WRONG
const { token } = useAuth();
console.log(token.substring(0, 10)); // Might crash if null
```

✅ **Correct**

```tsx
const { session } = useAuth();
if (!session) return <p>Loading...</p>;
console.log(session.token.substring(0, 10));
```

---

❌ **Subscribing but not unsubscribing**

```tsx
// WRONG
useEffect(() => {
  subscribeToUpdates(deviceId); // Memory leak!
}, [deviceId]);
```

✅ **Correct (handled by hook)**

```tsx
const update = useDeviceUpdates(deviceId); // Auto unsubscribe on unmount
```

---

## Testing

### Mock Authentication

```tsx
// Mock for testing
export const mockSession = {
  userId: "user-123",
  email: "test@example.com",
  organizationId: "org-123",
  organizationName: "Test Org",
  memberRole: "admin" as const,
  token: "mock-jwt-token",
  tokenExpires: Date.now() + 86400000,
};
```

### Mock useAuth

```tsx
jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: mockSession,
    user: null,
    login: jest.fn(),
    logout: jest.fn(),
    canRead: () => true,
    canWrite: () => true,
    canAdmin: () => true,
  }),
}));
```

---

For more details, see the other documentation files:

- [QUICK_START.md](./QUICK_START.md) - 30-minute setup guide
- [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) - Detailed integration guide
- [NEXT_JS_IMPLEMENTATION_SUMMARY.md](./NEXT_JS_IMPLEMENTATION_SUMMARY.md) - Complete overview
