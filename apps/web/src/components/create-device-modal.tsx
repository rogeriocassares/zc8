/**
 * Create Device Modal - Client Component
 * Modal wrapper for creating new devices
 */

"use client";

import { useState } from "react";
import { useDevices } from "@/lib/device-context";
import { CreateDeviceForm } from "./create-device-form";

interface CreateDeviceModalProps {
  organizationId: string;
  onSuccess?: () => void;
}

export function CreateDeviceModal({
  organizationId,
  onSuccess,
}: CreateDeviceModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { fetchDevices } = useDevices();

  return (
    <>
      {/* Create Device Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium transition-colors flex items-center gap-2"
      >
        <span>+</span>
        Create Device
      </button>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-slate-900 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-lg font-bold text-white">
                Create New Device
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              <CreateDeviceForm
                organizationId={organizationId}
                onSuccess={async () => {
                  setIsOpen(false);
                  await fetchDevices();
                  onSuccess?.();
                }}
                onCancel={() => setIsOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
