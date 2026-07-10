/**
 * Device Table Component - Displays devices with Redis last hash values and real-time updates
 */

"use client";

import { memo, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useDevices } from "@/lib/device-context";
import { DeviceActions } from "./device-actions";

interface DeviceRowProps {
  device: any; // Full device object
  lastHash: string;
  lastValue: unknown;
  timestamp: string;
  organizationId: string;
  onRefresh?: () => void;
}

function DeviceRow({
  device,
  lastHash,
  lastValue,
  timestamp,
  organizationId,
  onRefresh,
}: DeviceRowProps) {
  const { device_id, uuid, origin, status } = device;
  const deviceId = uuid || device.id;
  const deviceKey = device_id || device.id;

  const statusColors = {
    active: "bg-green-500/20 text-green-400 border-green-500/50",
    inactive: "bg-yellow-500/20 text-yellow-400 border-yellow-500/50",
    error: "bg-red-500/20 text-red-400 border-red-500/50",
  };

  const typeColors: { [key: string]: string } = {
    lorawan: "bg-blue-500/20 text-blue-400",
    lorawan_chirpstack: "bg-blue-500/20 text-blue-400",
    zc2x: "bg-purple-500/20 text-purple-400",
    mqtt: "bg-cyan-500/20 text-cyan-400",
    http: "bg-orange-500/20 text-orange-400",
    os_agent: "bg-indigo-500/20 text-indigo-400",
    unknown: "bg-slate-500/20 text-slate-400",
  };

  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "object")
      return JSON.stringify(value).slice(0, 50) + "...";
    return String(value).slice(0, 50);
  };

  // Map origin to device type for display
  const deviceTypeMap: { [key: string]: string } = {
    lorawan_chirpstack: "lorawan",
    zc2x: "zc2x",
    mqtt: "mqtt",
    http: "http",
    os_agent: "os_agent",
  };
  const mappedType = deviceTypeMap[(origin as string) || ""] || "unknown";

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-slate-300 truncate block">
          {deviceId}
        </span>
      </td>
      <td className="px-4 py-3">
        <code className="text-xs bg-slate-900 text-slate-300 px-2 py-1 rounded">
          {deviceKey}
        </code>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeColors[mappedType] || "bg-slate-500/20 text-slate-400"}`}
        >
          {mappedType.includes("_")
            ? mappedType.replace(/_/g, " ").toUpperCase()
            : mappedType.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors[status as keyof typeof statusColors]}`}
        >
          <span
            className={`h-2 w-2 mr-2 rounded-full ${status === "active" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-yellow-500"}`}
          ></span>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </td>
      <td className="px-4 py-3">
        <code className="text-xs bg-slate-900 text-slate-300 px-2 py-1 rounded font-mono truncate block max-w-xs">
          {lastHash || "—"}
        </code>
      </td>
      <td className="px-4 py-3">
        <div className="text-xs text-slate-400 max-w-xs truncate">
          {formatValue(lastValue)}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-slate-400 whitespace-nowrap">
          {timestamp}
        </span>
      </td>
      <td className="px-4 py-3">
        <DeviceActions device={device} organizationId={organizationId} />
      </td>
    </tr>
  );
}

// Memoize DeviceRow with custom comparison to prevent unnecessary re-renders
// Only re-render if device properties or display data actually changes
const MemoizedDeviceRow = memo(DeviceRow, (prevProps, nextProps) => {
  return (
    prevProps.device.id === nextProps.device.id &&
    prevProps.device.status === nextProps.device.status &&
    prevProps.device.model === nextProps.device.model &&
    prevProps.device.vendor_id === nextProps.device.vendor_id &&
    prevProps.device.origin === nextProps.device.origin &&
    prevProps.lastHash === nextProps.lastHash &&
    prevProps.lastValue === nextProps.lastValue &&
    prevProps.timestamp === nextProps.timestamp &&
    prevProps.organizationId === nextProps.organizationId
  );
});

export function DevicesTable() {
  const { session } = useAuth();
  const { devices, deviceUpdates, loading, error, wsConnected, fetchDevices } =
    useDevices();

  useEffect(() => {
    if (session?.token) {
      fetchDevices();
    }
  }, [session?.token, fetchDevices]);

  if (!session) {
    return (
      <div className="bg-slate-800 rounded-lg p-8 text-center">
        <p className="text-slate-400">Please log in to view devices</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-8 text-center">
        <div className="inline-flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-500"></div>
          <p className="text-slate-400">Loading devices...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
        <p className="text-red-400">Error: {error}</p>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-8 text-center">
        <p className="text-slate-400">No devices registered yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Bar */}
      <div className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-yellow-500"}`}
          ></span>
          <span className="text-sm text-slate-400">
            {wsConnected ? "Updates (polling every 10s)" : "Connecting..."}
          </span>
        </div>
        <span className="text-sm text-slate-400">
          {devices.length} device{devices.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-lg overflow-x-auto border border-slate-700">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Device ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Device Key
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Redis Last Hash
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Last Value
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Updated
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const update = deviceUpdates.get(String(device.id));
              const timestamp = update?.updatedAt
                ? new Date(update.updatedAt).toLocaleString()
                : new Date().toLocaleString();

              return (
                <MemoizedDeviceRow
                  key={device.id}
                  device={device}
                  lastHash={update?.lastHash || "—"}
                  lastValue={update?.lastValue}
                  timestamp={timestamp}
                  organizationId={String(session.organizationId)}
                  onRefresh={fetchDevices}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info Message */}
      <div className="text-xs text-slate-400 space-y-1">
        <p>• Real-time updates via WebSocket streaming</p>
        <p>• Redis last hash values show most recent device state</p>
        <p>• Status indicators: 🟢 Active, 🟡 Inactive, 🔴 Error</p>
      </div>
    </div>
  );
}
