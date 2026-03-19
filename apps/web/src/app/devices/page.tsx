/**
 * Device Registry Page - Static page for managing all devices
 * Allows creating, editing, and viewing all devices without WebSocket
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreateDeviceModal } from "@/components/create-device-modal";
import { DeviceRegistryTable } from "@/components/device-registry-table";
import { EditDeviceModal } from "@/components/edit-device-modal";
import { EditDeviceProvider, useEditDevice } from "@/hooks/useEditDevice";
import { useAuth } from "@/lib/auth-context";
import type { Device } from "@/lib/device-context";
import { DeviceProvider } from "@/lib/device-context";

function DeviceRegistryContent() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const { openEdit } = useEditDevice();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!loading && !session) {
      router.push("/auth/login");
    }
  }, [session, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const handleEditDevice = (device: Device) => {
    openEdit(device, session.organizationId);
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Device Registry</h1>
              <p className="text-slate-400 mt-1">
                Organization:{" "}
                <span className="font-semibold text-blue-400">
                  {session.organizationName}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <CreateDeviceModal
                organizationId={session.organizationId}
                onSuccess={handleRefresh}
              />

              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white mb-4">All Devices</h2>
            <DeviceRegistryTable
              key={refreshKey}
              onEdit={handleEditDevice}
              onRefresh={handleRefresh}
            />
          </div>
        </div>
      </main>

      {/* Modals */}
      <EditDeviceModal onSuccess={handleRefresh} />

      {/* Footer */}
      <footer className="bg-slate-800 border-t border-slate-700 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 text-center text-sm text-slate-400">
          <p>
            ZC8 Device Registry - Static device registry view (without real-time
            updates)
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function DeviceRegistry() {
  return (
    <DeviceProvider>
      <EditDeviceProvider>
        <DeviceRegistryContent />
      </EditDeviceProvider>
    </DeviceProvider>
  );
}
