/**
 * Device Context - Manages device data with Redis last update values and WebSocket streaming
 */

"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth-context";
import { subscribeNatsRealtime } from "./nats-realtime";

export interface DeviceLastUpdate {
  deviceId: string;
  lastHash: string;
  lastValue: unknown;
  timestamp: number;
  updatedAt: string;
}

export interface Device {
  id: string;
  uuid: string;
  tenant_id: string;
  device_type_id: string;
  device_id: string;
  deveui: string;
  jwt_secret_hash: string;
  vendor_id: string;
  model: string;
  parser_id: string | null;
  origin: string;
  status: "active" | "inactive" | "error";
  device_version: number;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

interface DeviceContextType {
  devices: Device[];
  deviceUpdates: Map<string, DeviceLastUpdate>;
  loading: boolean;
  error: string | null;
  wsConnected: boolean;
  fetchDevices: () => Promise<void>;
  subscribeToUpdates: (deviceId: string) => void;
  unsubscribeFromUpdates: (deviceId: string) => void;
  pausePolling: () => void;
  resumePolling: () => void;
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

const API_BASE =
  process.env.NEXT_PUBLIC_ELYSIA_API_URL || "http://localhost:3333";
const NATS_WS_URL =
  process.env.NEXT_PUBLIC_NATS_WS_URL || "ws://localhost:4223";

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceUpdates, setDeviceUpdates] = useState<
    Map<string, DeviceLastUpdate>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isPausingPolling, setIsPausingPolling] = useState(false);
  const subscriptionsRef = useRef<Set<string>>(new Set());

  // Extract and memoize session credentials to ensure stable dependencies
  const token = session?.token ?? null;
  const organizationId = session?.organizationId ?? null;

  // Fetch devices from API
  const fetchDevices = useCallback(async () => {
    if (!token || !organizationId) return;

    try {
      setLoading(true);
      setError(null);

      const url = `${API_BASE}/api/tenants/${organizationId}/devices`;
      console.log("Fetching devices from:", url);

      // Use tenant endpoint with organizationId from session
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("API response error:", {
          status: res.status,
          statusText: res.statusText,
          body: errorText,
        });
        throw new Error(
          `Failed to fetch devices: ${res.status} ${res.statusText}`,
        );
      }

      const data = await res.json();
      // Elysia returns devices array directly or in a wrapper
      const deviceList = Array.isArray(data) ? data : data.devices || [];
      setDevices(deviceList);

      // TODO: Fetch last updates from Redis for each device once endpoint is implemented
      // For now, skip to avoid 404 errors
      const updates = new Map<string, DeviceLastUpdate>();
      setDeviceUpdates(updates);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("Failed to fetch devices:", {
        error: err,
        url: `${API_BASE}/api/tenants/${organizationId}/devices`,
        hasToken: !!token,
      });
    } finally {
      setLoading(false);
    }
  }, [token, organizationId]);

  // Connect to NATS for real-time telemetry updates
  useEffect(() => {
    if (!token || !organizationId) return;

    let cleanup: (() => void) | null = null;

    subscribeNatsRealtime({
      wsUrl: NATS_WS_URL,
      token,
      orgId: organizationId,
      onMessage: (event) => {
        setDeviceUpdates((prev) => {
          const updated = new Map(prev);
          const deviceKeyStr = String(event.device_key);
          updated.set(deviceKeyStr, {
            deviceId: deviceKeyStr,
            lastHash: "",
            lastValue: event.fields,
            timestamp: event.ts * 1000,
            updatedAt: new Date(event.ts * 1000).toISOString(),
          });
          return updated;
        });
      },
      onConnected: () => setWsConnected(true),
      onDisconnected: () => setWsConnected(false),
    }).then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
      setWsConnected(false);
    };
  }, [token, organizationId]);

  // Track subscribed devices (NATS subscription covers the whole org by subject pattern)
  const subscribeToUpdates = useCallback((deviceId: string) => {
    subscriptionsRef.current.add(deviceId);
  }, []);

  // Unsubscribe from device updates
  const unsubscribeFromUpdates = useCallback((deviceId: string) => {
    subscriptionsRef.current.delete(deviceId);
  }, []);

  // Pause polling (used when edit/create forms are open)
  const pausePolling = useCallback(() => {
    setIsPausingPolling(true);
  }, []);

  // Resume polling (used when forms are closed)
  const resumePolling = useCallback(() => {
    setIsPausingPolling(false);
  }, []);

  // Load devices on mount and set up polling
  useEffect(() => {
    if (!token) return;

    // Fetch immediately
    fetchDevices();

    // Poll every 60 seconds as fallback (WebSocket handles realtime)
    const interval = setInterval(() => {
      if (!isPausingPolling) {
        fetchDevices();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchDevices, token, isPausingPolling]);

  return (
    <DeviceContext.Provider
      value={{
        devices,
        deviceUpdates,
        loading,
        error,
        wsConnected,
        fetchDevices,
        subscribeToUpdates,
        unsubscribeFromUpdates,
        pausePolling,
        resumePolling,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevices() {
  const context = useContext(DeviceContext);
  if (context === undefined) {
    throw new Error("useDevices must be used within DeviceProvider");
  }
  return context;
}

export function useDeviceUpdates(deviceId: string | null) {
  const { deviceUpdates, subscribeToUpdates, unsubscribeFromUpdates } =
    useDevices();

  useEffect(() => {
    if (!deviceId) return;

    subscribeToUpdates(deviceId);

    return () => {
      unsubscribeFromUpdates(deviceId);
    };
  }, [deviceId, subscribeToUpdates, unsubscribeFromUpdates]);

  return deviceUpdates.get(deviceId || "");
}
