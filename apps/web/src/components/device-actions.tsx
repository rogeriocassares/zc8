/**
 * Device Actions - Client Component
 * Handles actions like edit, delete, view details for devices
 */

"use client";

import { useEditDevice } from "@/hooks/useEditDevice";
import type { Device } from "@/lib/device-context";

interface DeviceActionsProps {
  device: Device;
  organizationId: string;
}

export function DeviceActions({ device, organizationId }: DeviceActionsProps) {
  const { openEdit } = useEditDevice();

  return (
    <div className="flex gap-2">
      <button
        onClick={() => openEdit(device, organizationId)}
        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        title="Edit device"
        type="button"
      >
        Edit
      </button>
      <button
        className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
        title="View details"
        type="button"
      >
        Details
      </button>
    </div>
  );
}
