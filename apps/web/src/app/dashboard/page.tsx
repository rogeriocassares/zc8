/**
 * Dashboard Page - Main app showing devices table
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CreateDeviceModal } from "@/components/create-device-modal";
import { EditDeviceModal } from "@/components/edit-device-modal";
import { OnlineDevicesTable } from "@/components/online-devices-table";
import { EditDeviceProvider } from "@/hooks/useEditDevice";
import { useAuth } from "@/lib/auth-context";
import { DeviceProvider } from "@/lib/device-context";

function DashboardContent() {
  const router = useRouter();
  const { session, user, logout, switchOrganization, loading } = useAuth();

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

  const handleLogout = async () => {
    await logout();
    router.push("/auth/login");
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

            {/* User Menu */}
            <div className="flex items-center gap-4">
              <CreateDeviceModal organizationId={session.organizationId} />

              <div className="text-right">
                <p className="text-sm font-medium text-slate-200">
                  {session.email}
                </p>
                <p className="text-xs text-slate-400 capitalize">
                  {session.memberRole}
                </p>
              </div>

              {/* Organization Switcher */}
              {user && user.organizations.length > 1 && (
                <select
                  value={session.organizationId}
                  onChange={(e) => switchOrganization(e.target.value)}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                >
                  {user.organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm font-medium">
                Member Role
              </div>
              <div className="text-2xl font-bold text-white capitalize mt-2">
                {session.memberRole}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm font-medium">
                Organizations
              </div>
              <div className="text-2xl font-bold text-white mt-2">
                {user?.organizations.length || 1}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm font-medium">
                Permissions
              </div>
              <div className="text-xs text-green-400 mt-2 space-y-1">
                <p>✓ Read devices</p>
                {session.memberRole !== "viewer" && <p>✓ Write devices</p>}
                {session.memberRole === "admin" && <p>✓ Admin access</p>}
              </div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-slate-400 text-sm font-medium">
                Tenant ID
              </div>
              <div className="text-lg font-mono text-slate-300 mt-2 truncate">
                {session.organizationId}
              </div>
            </div>
          </div>

          {/* Online Devices Table Section */}
          <div>
            <h2 className="text-xl font-bold text-white mb-4">
              Online Devices (Real-time Updates)
            </h2>
            <OnlineDevicesTable />
          </div>
        </div>
      </main>

      {/* Modals */}
      <CreateDeviceModal organizationId={session.organizationId} />
      <EditDeviceModal />

      {/* Footer */}
      <footer className="bg-slate-800 border-t border-slate-700 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 text-center text-sm text-slate-400">
          <p>
            ZC8 Device Registry v3 - Member-based RBAC with real-time updates
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function Dashboard() {
  return (
    <DeviceProvider>
      <EditDeviceProvider>
        <DashboardContent />
      </EditDeviceProvider>
    </DeviceProvider>
  );
}
