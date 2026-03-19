/**
 * Edit Device Form - Client Component with Server Actions
 * Handles editing existing devices in the device registry
 */

"use client";

import { type FormEvent, useState } from "react";
import { updateDevice } from "@/app/actions/device-actions";
import type { Device } from "@/lib/device-context";

interface EditDeviceFormProps {
  device: Device;
  organizationId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function EditDeviceForm({
  device,
  organizationId,
  onSuccess,
  onCancel,
}: EditDeviceFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData(e.currentTarget);
      console.log("Edit form submitting for device ID:", device.id);
      const result = await updateDevice(
        organizationId,
        String(device.id),
        formData,
        device.metadata || {},
      );

      console.log("Edit form result:", result);
      if (result.success) {
        console.log("Edit successful, calling onSuccess");
        onSuccess?.();
      } else {
        console.error("Edit failed:", result.error);
        setError(result.error || "Failed to update device");
      }
    } catch (err) {
      console.error("Edit form error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  const metadata = device.metadata || {};
  const description =
    typeof metadata === "object" &&
    metadata !== null &&
    "description" in metadata
      ? (metadata as any).description
      : "";
  const location =
    typeof metadata === "object" && metadata !== null && "location" in metadata
      ? (metadata as any).location
      : "";

  return (
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h2 className="text-xl font-bold text-white mb-6">Edit Device</h2>

      {error && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/50 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Device ID (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Device ID (Read-only)
            </label>
            <input
              type="text"
              disabled
              value={device.device_id || device.id}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-400 cursor-not-allowed opacity-50"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Model *
            </label>
            <input
              type="text"
              name="model"
              required
              defaultValue={device.model || ""}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              placeholder="Device Model"
              disabled={isLoading}
            />
          </div>

          {/* Vendor ID */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Vendor ID
            </label>
            <input
              type="text"
              name="vendor_id"
              defaultValue={device.vendor_id || ""}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              placeholder="vendor-name"
              disabled={isLoading}
            />
          </div>

          {/* Origin / Device Type */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Device Type *
            </label>
            <select
              name="origin"
              required
              defaultValue={device.origin || ""}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              disabled={isLoading}
            >
              <option value="">Select Type</option>
              <option value="lorawan_chirpstack">LoRaWAN (ChirpStack)</option>
              <option value="mqtt">MQTT</option>
              <option value="http">HTTP</option>
              <option value="zc2x">ZC2x</option>
              <option value="os_agent">OS Agent</option>
            </select>
          </div>

          {/* DevEUI (LoRaWAN) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              DevEUI (LoRaWAN)
            </label>
            <input
              type="text"
              name="deveui"
              defaultValue={device.deveui || ""}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              placeholder="0000000000000000"
              disabled={isLoading}
            />
          </div>

          {/* Parser ID */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Parser ID
            </label>
            <input
              type="text"
              name="parser_id"
              defaultValue={device.parser_id || ""}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              placeholder="parser-name"
              disabled={isLoading}
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Status
            </label>
            <select
              name="status"
              defaultValue={device.status}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              disabled={isLoading}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Description
          </label>
          <textarea
            name="description"
            rows={3}
            defaultValue={description}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50"
            placeholder="Device description..."
            disabled={isLoading}
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Location
          </label>
          <input
            type="text"
            name="location"
            defaultValue={location}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            placeholder="Device location"
            disabled={isLoading}
          />
        </div>

        {/* Metadata Info */}
        <div className="bg-slate-700/50 border border-slate-600 rounded p-3">
          <p className="text-xs text-slate-400">
            <strong>Device UUID:</strong> {device.uuid}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            <strong>Created:</strong>{" "}
            {new Date(device.created_at).toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            <strong>Last Updated:</strong>{" "}
            {new Date(device.updated_at).toLocaleString()}
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-slate-300 bg-slate-700 hover:bg-slate-600 rounded transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
            disabled={isLoading}
          >
            {isLoading && (
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
            )}
            {isLoading ? "Updating..." : "Update Device"}
          </button>
        </div>
      </form>
    </div>
  );
}
