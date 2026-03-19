/**
 * Edit Device Modal - Renders at dashboard level using context
 * This prevents the modal from being affected by table re-renders
 */

"use client";

import { useEditDevice } from "@/hooks/useEditDevice";
import { useDevices } from "@/lib/device-context";
import { EditDeviceForm } from "./edit-device-form";

interface EditDeviceModalProps {
  onSuccess?: () => void;
}

export function EditDeviceModal({ onSuccess }: EditDeviceModalProps = {}) {
  const { isOpen, device, organizationId, closeEdit } = useEditDevice();
  const { fetchDevices } = useDevices();

  if (!isOpen || !device || !organizationId) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-slate-900 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-white">Edit Device</h2>
          <button
            onClick={closeEdit}
            className="text-slate-400 hover:text-white text-2xl leading-none"
            type="button"
          >
            ×
          </button>
        </div>
        <div className="p-6">
          <EditDeviceForm
            device={device}
            organizationId={organizationId}
            onSuccess={async () => {
              closeEdit();
              await fetchDevices();
              onSuccess?.();
            }}
            onCancel={closeEdit}
          />
        </div>
      </div>
    </div>
  );
}
