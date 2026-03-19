/**
 * Edit Device Page - Standalone page for editing a device
 * Accessed when user clicks Edit in the device table
 */

"use client";

import { useRouter } from "next/navigation";
import type { Device } from "@/lib/device-context";
import { EditDeviceForm } from "./edit-device-form";

interface EditDevicePageProps {
  device: Device;
  organizationId: string;
}

export function EditDevicePage({
  device,
  organizationId,
}: EditDevicePageProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Edit Device</h1>
            <p className="text-slate-400">
              Device ID:{" "}
              <span className="font-mono text-slate-300">
                {device.device_id}
              </span>
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
          >
            ← Back
          </button>
        </div>

        {/* Form Container */}
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-8">
          <EditDeviceForm
            device={device}
            organizationId={organizationId}
            onSuccess={() => {
              // Refresh and go back
              router.back();
            }}
            onCancel={() => router.back()}
          />
        </div>
      </div>
    </div>
  );
}
