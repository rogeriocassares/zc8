/**
 * Online Devices Table Component
 * Shows real-time device data with WebSocket connections
 * Has a button to navigate to the full static Device Registry
 */

"use client";

import { useRouter } from "next/navigation";
import { memo, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import type { Device } from "@/lib/device-context";
import { useDevices } from "@/lib/device-context";
import { DeviceActions } from "./device-actions";

interface DeviceRowProps {
  device: Device;
  lastHash: string;
  lastValue: unknown;
  timestamp: string;
  organizationId: string;
}

function DeviceRow({
  device,
  lastHash,
  lastValue,
  timestamp,
  organizationId,
}: DeviceRowProps) {
  const { device_id, uuid, origin, status } = device as unknown as Record<
    string,
    unknown
  >;
  const deviceId = (uuid || device.id) as string;
  const deviceKey = (device_id || device.id) as string;

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
    if (typeof value === "object") {
      try {
        return JSON.stringify(value).slice(0, 100);
      } catch {
        return String(value).slice(0, 100);
      }
    }
    return String(value).slice(0, 100);
  };

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-800/50 transition-colors">
      <td className="px-6 py-4 text-sm text-slate-200">{String(deviceKey)}</td>
      <td className="px-6 py-4 font-mono text-xs text-slate-400">
        {String(deviceId)}
      </td>
      <td className="px-6 py-4 text-sm text-slate-200">
        {String(device.model)}
      </td>
      <td className="px-6 py-4 text-sm">
        <span
          className={`px-2 py-1 rounded text-xs font-medium ${
            typeColors[String(origin) as string] || typeColors.unknown
          }`}
        >
          {String(origin)}
        </span>
      </td>
      <td className="px-6 py-4 text-sm">
        <span
          className={`px-2 py-1 rounded border text-xs font-medium ${
            statusColors[String(status) as keyof typeof statusColors] ||
            statusColors.inactive
          }`}
        >
          {String(status)}
        </span>
      </td>
      <td className="px-6 py-4 text-sm">
        <span className="px-2 py-1 rounded bg-slate-700/50 text-slate-300 text-xs font-mono">
          {lastHash}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-slate-400">
        {formatValue(lastValue)}
      </td>
      <td className="px-6 py-4 text-xs text-slate-400">{timestamp}</td>
      <td className="px-6 py-4 text-sm">
        <DeviceActions device={device} organizationId={organizationId} />
      </td>
    </tr>
  );
}

const MemoizedDeviceRow = memo(DeviceRow, (prevProps, nextProps) => {
  return (
    prevProps.device.id === nextProps.device.id &&
    prevProps.lastHash === nextProps.lastHash &&
    prevProps.timestamp === nextProps.timestamp
  );
});

export function OnlineDevicesTable() {
  const router = useRouter();
  const { session } = useAuth();
  const { devices, deviceUpdates, loading, wsConnected, fetchDevices } =
    useDevices();

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-8 text-center">
        <div className="text-slate-400">Loading online devices...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-400">
            {devices.length} device{devices.length !== 1 ? "s" : ""} online
          </div>
          <div
            className={`w-3 h-3 rounded-full ${
              wsConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-slate-400">
            {wsConnected ? "Connected" : "Disconnected"}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fetchDevices()}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => router.push("/devices")}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors font-medium"
          >
            → Full Device Registry
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-800 border-b border-slate-700 sticky top-0">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Device ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                UUID
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Model
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Last Hash
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Last Value
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Timestamp
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {devices.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center">
                  <div className="text-slate-400">No devices found</div>
                  <button
                    type="button"
                    onClick={() => router.push("/devices")}
                    className="mt-4 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                  >
                    Manage devices →
                  </button>
                </td>
              </tr>
            ) : (
              devices.map((device) => {
                const update = deviceUpdates.get(device.id || "");
                return (
                  <MemoizedDeviceRow
                    key={device.id}
                    device={device}
                    lastHash={update?.lastHash || "—"}
                    lastValue={update?.lastValue}
                    timestamp={update?.updatedAt || "—"}
                    organizationId={
                      session?.organizationId != null
                        ? String(session.organizationId)
                        : ""
                    }
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
