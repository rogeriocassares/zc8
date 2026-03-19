/**
 * Device Registry Table - Static component without WebSocket
 * Simple table for managing devices (create, read, update, delete)
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { Device } from "@/lib/device-context";

interface DeviceRegistryTableProps {
  onEdit?: (device: Device) => void;
  onRefresh?: () => void;
}

export function DeviceRegistryTable({
  onEdit,
  onRefresh,
}: DeviceRegistryTableProps) {
  const { session } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDevices = useCallback(async () => {
    if (!session?.organizationId) return;

    try {
      setLoading(true);
      setError(null);

      const apiBase =
        process.env.NEXT_PUBLIC_ELYSIA_API_URL || "http://localhost:3333";
      const url = `${apiBase}/api/tenants/${session.organizationId}/devices`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch devices");
      }

      const data = await response.json();
      console.log("Fetched devices:", data);
      setDevices(Array.isArray(data) ? data : data.devices || []);
    } catch (err) {
      console.error("Error fetching devices:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [session?.organizationId, session?.token]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleRefresh = async () => {
    await fetchDevices();
    onRefresh?.();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-slate-800 rounded-lg border border-slate-700">
        <div className="text-slate-400">Loading devices...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/50 rounded text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-400">
          Showing {devices.length} device{devices.length !== 1 ? "s" : ""}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Device ID
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Model
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Type
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                DevEUI
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Organization
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Created
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Status
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-slate-300">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {devices.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-6 py-8 text-center text-slate-400 text-sm"
                >
                  No devices found
                </td>
              </tr>
            ) : (
              devices.map((device) => {
                const statusColors: Record<string, string> = {
                  active: "bg-green-500/20 text-green-400",
                  inactive: "bg-yellow-500/20 text-yellow-400",
                  error: "bg-red-500/20 text-red-400",
                };

                const typeColors: Record<string, string> = {
                  lorawan_chirpstack: "bg-blue-500/20 text-blue-400",
                  mqtt: "bg-cyan-500/20 text-cyan-400",
                  http: "bg-orange-500/20 text-orange-400",
                  zc2x: "bg-purple-500/20 text-purple-400",
                  os_agent: "bg-indigo-500/20 text-indigo-400",
                };

                const isLoRaWAN = device.origin?.includes("lorawan");
                const createdDate = new Date(
                  device.created_at,
                ).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                });

                return (
                  <tr
                    key={device.id}
                    className="hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {device.device_id || device.id}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {device.model}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          typeColors[device.origin] ||
                          "bg-slate-500/20 text-slate-400"
                        }`}
                      >
                        {device.origin}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {isLoRaWAN && device.deveui ? (
                        <span className="font-mono text-xs bg-slate-700/50 px-2 py-1 rounded">
                          {device.deveui}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-200">
                      {session?.organizationName || "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {createdDate}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          statusColors[device.status] ||
                          "bg-slate-500/20 text-slate-400"
                        }`}
                      >
                        {device.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        type="button"
                        onClick={() => onEdit?.(device)}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
