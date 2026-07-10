"use client";

/**
 * Integration Profiles Tab
 *
 * Manages integration profiles for an organization.  A profile bundles
 * input + output services; applications reference a profile to route
 * telemetry to outputs.
 */

import {
  Add01Icon,
  Delete02Icon,
  Edit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileService = {
  id: number;
  serviceId: number;
  serviceName: string;
  serviceType: string;
  role: "input" | "output";
  priority: number;
  isActive: boolean;
  topicTemplate: string | null;
};

type Profile = {
  id: number;
  orgId: number;
  name: string;
  description: string | null;
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
  services?: ProfileService[];
};

type ServiceOption = {
  id: number;
  name: string;
  serviceType: string;
  isLoraWan?: boolean;
};

type OrgDevice = {
  id: string;
  device_key: string;
  device_model_name: string;
  vendor_name: string;
  is_active: boolean;
};

// Raw shape returned by GET /api/v1/services
type ServiceApiRow = {
  id: number;
  name: string;
  service_type: string;
  is_lorawan?: boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function IntegrationProfilesTab({
  token,
  orgId,
}: {
  token: string;
  orgId: number | null;
}) {
  const [profiles, setProfiles] = React.useState<Profile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Create
  const [showCreate, setShowCreate] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createDescription, setCreateDescription] = React.useState("");
  const [createIsGlobal, setCreateIsGlobal] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createAvailServices, setCreateAvailServices] = React.useState<
    ServiceOption[]
  >([]);
  const [createLoadingSvcs, setCreateLoadingSvcs] = React.useState(false);
  const [createInputSvcs, setCreateInputSvcs] = React.useState<
    Array<{ _key: number; serviceId: string; topicTemplate: string }>
  >([]);
  const [createOutputSvcs, setCreateOutputSvcs] = React.useState<
    Array<{ _key: number; serviceId: string; topicTemplate: string }>
  >([]);

  // Edit
  const [editTarget, setEditTarget] = React.useState<Profile | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editAvailServices, setEditAvailServices] = React.useState<
    ServiceOption[]
  >([]);
  const [editLoadingSvcs, setEditLoadingSvcs] = React.useState(false);
  const [editInputSvcs, setEditInputSvcs] = React.useState<
    Array<{
      _key: number;
      serviceId: string;
      topicTemplate: string;
      originalServiceId?: number;
    }>
  >([]);
  const [editOutputSvcs, setEditOutputSvcs] = React.useState<
    Array<{
      _key: number;
      serviceId: string;
      topicTemplate: string;
      originalServiceId?: number;
    }>
  >([]);
  const [editOriginalSvcIds, setEditOriginalSvcIds] = React.useState<
    Set<number>
  >(new Set());

  // Delete
  const [deleteTarget, setDeleteTarget] = React.useState<Profile | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Profile detail / services management
  const [expandedProfile, setExpandedProfile] = React.useState<Profile | null>(
    null,
  );
  const [availableServices, setAvailableServices] = React.useState<
    ServiceOption[]
  >([]);
  const [addServiceId, setAddServiceId] = React.useState<string>("");
  const [addingService, setAddingService] = React.useState(false);
  const [addSvcError, setAddSvcError] = React.useState<string | null>(null);

  // Device Assignment
  const [devicesProfile, setDevicesProfile] = React.useState<Profile | null>(
    null,
  );
  const [allOrgDevices, setAllOrgDevices] = React.useState<OrgDevice[]>([]);
  const [assignedDeviceIds, setAssignedDeviceIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [pendingDeviceIds, setPendingDeviceIds] = React.useState<Set<string>>(
    new Set(),
  );
  const [deviceSearch, setDeviceSearch] = React.useState("");
  const [loadingDevices, setLoadingDevices] = React.useState(false);
  const [applyingDevices, setApplyingDevices] = React.useState(false);
  const [deviceError, setDeviceError] = React.useState<string | null>(null);
  const [applySuccess, setApplySuccess] = React.useState(false);
  const [deviceAssignments, setDeviceAssignments] = React.useState<
    Map<string, string>
  >(new Map());

  const fetchProfiles = React.useCallback(async () => {
    if (!token || !orgId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "API error");
      setProfiles(json.data as Profile[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, orgId]);

  React.useEffect(() => {
    if (loaded.current || !token || !orgId) return;
    loaded.current = true;
    fetchProfiles();
  }, [fetchProfiles, token, orgId]);

  // Load available services when create sheet opens
  React.useEffect(() => {
    if (!showCreate || !token) return;
    setCreateLoadingSvcs(true);
    const qs = orgId ? `?org_id=${orgId}` : "";
    fetch(`${API}/api/v1/services${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success)
          setCreateAvailServices(
            (json.data as ServiceApiRow[]).map((s) => ({
              id: s.id,
              name: s.name,
              serviceType: s.service_type,
              isLoraWan: s.is_lorawan,
            })),
          );
      })
      .catch(() => {})
      .finally(() => setCreateLoadingSvcs(false));
  }, [showCreate, token, orgId]);

  // Load available services when edit sheet opens
  React.useEffect(() => {
    if (!showEdit || !token) return;
    const qs = orgId ? `?org_id=${orgId}` : "";
    fetch(`${API}/api/v1/services${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success)
          setEditAvailServices(
            (json.data as ServiceApiRow[]).map((s) => ({
              id: s.id,
              name: s.name,
              serviceType: s.service_type,
              isLoraWan: s.is_lorawan,
            })),
          );
      })
      .catch(() => {});
  }, [showEdit, token, orgId]);

  // Load available services when managing a profile
  React.useEffect(() => {
    if (!expandedProfile || !token) return;
    const qs = orgId ? `?org_id=${orgId}` : "";
    fetch(`${API}/api/v1/services${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.success)
          setAvailableServices(
            (json.data as ServiceApiRow[]).map((s) => ({
              id: s.id,
              name: s.name,
              serviceType: s.service_type,
              isLoraWan: s.is_lorawan,
            })),
          );
      })
      .catch(() => {});
  }, [expandedProfile, token, orgId]);

  // ── CRUD helpers ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!orgId) return;
    setCreating(true);
    setCreateError(null);
    try {
      // 1. Create the profile
      const r = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: createName,
            description: createDescription || undefined,
            isGlobal: createIsGlobal,
          }),
        },
      );
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "API error");
      const created = json.data as Profile;

      // 2. Link input services
      for (const entry of createInputSvcs) {
        if (!entry.serviceId) continue;
        await fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${created.id}/services`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              serviceId: Number(entry.serviceId),
              role: "input",
              topicTemplate: entry.topicTemplate || undefined,
            }),
          },
        );
      }

      // 3. Link output services
      for (const entry of createOutputSvcs) {
        if (!entry.serviceId) continue;
        await fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${created.id}/services`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              serviceId: Number(entry.serviceId),
              role: "output",
              topicTemplate: entry.topicTemplate || undefined,
            }),
          },
        );
      }

      // 4. Fetch full profile with services for the table
      const profileR = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${created.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const profileJson = await profileR.json();
      const fullProfile = profileJson.success
        ? (profileJson.data as Profile)
        : created;

      setProfiles((p) => [...p, fullProfile]);
      setShowCreate(false);
      setCreateName("");
      setCreateDescription("");
      setCreateIsGlobal(false);
      setCreateInputSvcs([]);
      setCreateOutputSvcs([]);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const openEdit = async (p: Profile) => {
    setEditTarget(p);
    setEditName(p.name);
    setEditDescription(p.description ?? "");
    setEditError(null);
    setEditLoadingSvcs(true);
    setShowEdit(true);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${p.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await r.json();
      const full = json.success ? (json.data as Profile) : p;
      const svcs = full.services ?? [];
      setEditOriginalSvcIds(new Set(svcs.map((s) => s.serviceId)));
      let k = Date.now();
      setEditInputSvcs(
        svcs
          .filter((s) => s.role === "input")
          .map((s) => ({
            _key: k++,
            serviceId: String(s.serviceId),
            topicTemplate: s.topicTemplate ?? "",
            originalServiceId: s.serviceId,
          })),
      );
      setEditOutputSvcs(
        svcs
          .filter((s) => s.role === "output")
          .map((s) => ({
            _key: k++,
            serviceId: String(s.serviceId),
            topicTemplate: s.topicTemplate ?? "",
            originalServiceId: s.serviceId,
          })),
      );
    } catch {
      setEditInputSvcs([]);
      setEditOutputSvcs([]);
    } finally {
      setEditLoadingSvcs(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget || !orgId) return;
    setSaving(true);
    setEditError(null);
    try {
      // 1. Update name/description
      const r = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${editTarget.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editName,
            description: editDescription || undefined,
          }),
        },
      );
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "API error");

      // 2. Compute which service IDs are still present
      const newInputIds = new Set(
        editInputSvcs
          .filter((e) => e.serviceId)
          .map((e) => Number(e.serviceId)),
      );
      const newOutputIds = new Set(
        editOutputSvcs
          .filter((e) => e.serviceId)
          .map((e) => Number(e.serviceId)),
      );
      const allNewIds = new Set([...newInputIds, ...newOutputIds]);

      // 3. Delete removed services
      for (const origId of editOriginalSvcIds) {
        if (!allNewIds.has(origId)) {
          await fetch(
            `${API}/api/v1/orgs/${orgId}/integration-profiles/${editTarget.id}/services/${origId}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            },
          );
        }
      }

      // 4. Upsert input services (insert new, update topicTemplate for existing via ON CONFLICT)
      for (const entry of editInputSvcs) {
        if (!entry.serviceId) continue;
        await fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${editTarget.id}/services`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              serviceId: Number(entry.serviceId),
              role: "input",
              topicTemplate: entry.topicTemplate || undefined,
            }),
          },
        );
      }

      // 5. Upsert output services (insert new, update topicTemplate for existing via ON CONFLICT)
      for (const entry of editOutputSvcs) {
        if (!entry.serviceId) continue;
        await fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${editTarget.id}/services`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              serviceId: Number(entry.serviceId),
              role: "output",
              topicTemplate: entry.topicTemplate || undefined,
            }),
          },
        );
      }

      // 6. Fetch fresh profile for table update
      const profileR = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${editTarget.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const profileJson = await profileR.json();
      const updated = profileJson.success
        ? (profileJson.data as Profile)
        : (json.data as Profile);
      setProfiles((ps) =>
        ps.map((p) => (p.id === editTarget.id ? updated : p)),
      );
      setShowEdit(false);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !orgId) return;
    setDeleting(true);
    try {
      await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${deleteTarget.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setProfiles((ps) => ps.filter((p) => p.id !== deleteTarget.id));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const openManageServices = async (p: Profile) => {
    // Fetch the profile with services
    if (!orgId) return;
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${p.id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await r.json();
      if (json.success) setExpandedProfile(json.data as Profile);
    } catch {
      setExpandedProfile({ ...p, services: [] });
    }
  };

  const handleAddService = async () => {
    if (!expandedProfile || !addServiceId || !orgId) return;
    setAddingService(true);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/${expandedProfile.id}/services`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            serviceId: Number(addServiceId),
            role: availableServices
              .find((s) => s.id === Number(addServiceId))
              ?.serviceType.startsWith("input.")
              ? "input"
              : "output",
          }),
        },
      );
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "API error");
      setExpandedProfile((prev) =>
        prev
          ? {
              ...prev,
              services: [...(prev.services ?? []), json.data as ProfileService],
            }
          : prev,
      );
      setAddServiceId("");
      setAddSvcError(null);
    } catch (e) {
      setAddSvcError((e as Error).message);
    } finally {
      setAddingService(false);
    }
  };

  const handleRemoveService = async (serviceId: number) => {
    if (!expandedProfile || !orgId) return;
    await fetch(
      `${API}/api/v1/orgs/${orgId}/integration-profiles/${expandedProfile.id}/services/${serviceId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    setExpandedProfile((prev) =>
      prev
        ? {
            ...prev,
            services: (prev.services ?? []).filter(
              (s) => s.serviceId !== serviceId,
            ),
          }
        : prev,
    );
  };

  const openManageDevices = async (p: Profile) => {
    setDevicesProfile(p);
    setDeviceSearch("");
    setDeviceError(null);
    setApplySuccess(false);
    setLoadingDevices(true);
    try {
      const [allR, assignedR, assignmentsR] = await Promise.all([
        fetch(`${API}/api/v1/devices?org_id=${orgId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${p.id}/devices`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/device-assignments`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      ]);
      const [allJson, assignedJson, assignmentsJson] = await Promise.all([
        allR.json(),
        assignedR.json(),
        assignmentsR.json(),
      ]);
      setAllOrgDevices(allJson.success ? (allJson.data as OrgDevice[]) : []);
      const ids = new Set<string>(
        (assignedJson.success ? assignedJson.data : []).map(
          (d: OrgDevice) => d.id,
        ),
      );
      setAssignedDeviceIds(ids);
      setPendingDeviceIds(new Set(ids));
      if (assignmentsJson.success) {
        const map = new Map<string, string>();
        for (const row of assignmentsJson.data as {
          device_id: string;
          profile_id: number;
          profile_name: string;
        }[]) {
          if (row.profile_id !== p.id) {
            map.set(row.device_id, row.profile_name);
          }
        }
        setDeviceAssignments(map);
      }
    } catch {
      setAllOrgDevices([]);
      setAssignedDeviceIds(new Set());
      setPendingDeviceIds(new Set());
      setDeviceAssignments(new Map());
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleApplyDevices = async () => {
    if (!devicesProfile || !orgId) return;
    setApplyingDevices(true);
    setDeviceError(null);
    setApplySuccess(false);
    try {
      const toAdd = [...pendingDeviceIds].filter(
        (id) => !assignedDeviceIds.has(id),
      );
      const toRemove = [...assignedDeviceIds].filter(
        (id) => !pendingDeviceIds.has(id),
      );
      if (toAdd.length > 0) {
        const r = await fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${devicesProfile.id}/devices`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ device_ids: toAdd }),
          },
        );
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
      }
      for (const id of toRemove) {
        await fetch(
          `${API}/api/v1/orgs/${orgId}/integration-profiles/${devicesProfile.id}/devices/${id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      }
      setAssignedDeviceIds(new Set(pendingDeviceIds));
      setApplySuccess(true);
      // Refresh cross-profile conflict map
      const assignmentsR = await fetch(
        `${API}/api/v1/orgs/${orgId}/integration-profiles/device-assignments`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const assignmentsJson = await assignmentsR.json();
      if (assignmentsJson.success) {
        const map = new Map<string, string>();
        for (const row of assignmentsJson.data as {
          device_id: string;
          profile_id: number;
          profile_name: string;
        }[]) {
          if (row.profile_id !== devicesProfile.id) {
            map.set(row.device_id, row.profile_name);
          }
        }
        setDeviceAssignments(map);
      }
    } catch (e) {
      setDeviceError((e as Error).message);
    } finally {
      setApplyingDevices(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!orgId) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        Select an organization to manage integration profiles.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Integration Profiles</h2>
          <p className="text-muted-foreground text-sm">
            Bundle input + output services. Assign a profile to an application
            to route its devices to the correct outputs.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
          New Profile
        </Button>
      </div>

      {/* Error */}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Global</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Devices</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground text-center"
                >
                  No profiles yet. Create one to start routing telemetry.
                </TableCell>
              </TableRow>
            ) : (
              profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    {p.isGlobal ? (
                      <Badge variant="secondary">Global</Badge>
                    ) : (
                      <Badge variant="outline">Org</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openManageServices(p)}
                    >
                      Manage services
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openManageDevices(p)}
                    >
                      Manage devices
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(p)}
                      >
                        <HugeiconsIcon icon={Edit01Icon} size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {/* ── Create Sheet ─────────────────────────────────────────────────── */}
      <Sheet
        modal={false}
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) {
            setCreateName("");
            setCreateDescription("");
            setCreateIsGlobal(false);
            setCreateInputSvcs([]);
            setCreateOutputSvcs([]);
            setCreateError(null);
          }
        }}
      >
        <SheetContent
          className="w-[520px] sm:max-w-[520px] overflow-y-auto"
          hideOverlay
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle>New Integration Profile</SheetTitle>
            <SheetDescription>
              Create a reusable routing bundle. Services are pulled from your
              existing integrations — manage them in the Integrations tab.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-1">
              <Label htmlFor="create-name">Name *</Label>
              <Input
                id="create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Fleet LoRaWAN → InfluxDB"
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label htmlFor="create-desc">Description</Label>
              <Input
                id="create-desc"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>

            {/* Input services */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Input services</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    createLoadingSvcs ||
                    (createInputSvcs.length > 0 &&
                      !createInputSvcs[createInputSvcs.length - 1].serviceId)
                  }
                  onClick={() =>
                    setCreateInputSvcs((prev) => [
                      ...prev,
                      {
                        _key: Date.now() + Math.random(),
                        serviceId: "",
                        topicTemplate: "",
                      },
                    ])
                  }
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} className="mr-1" />
                  Add
                </Button>
              </div>
              {createInputSvcs.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No input services — add one above.
                </p>
              ) : (
                createInputSvcs.map((entry) => (
                  <div key={entry._key} className="flex items-center gap-2">
                    <Select
                      value={entry.serviceId}
                      onValueChange={(v) =>
                        setCreateInputSvcs((prev) =>
                          prev.map((e) =>
                            e._key === entry._key ? { ...e, serviceId: v } : e,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select service…" />
                      </SelectTrigger>
                      <SelectContent>
                        {createAvailServices
                          .filter((s) => s.serviceType?.startsWith("input."))
                          .map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name}{" "}
                              {s.isLoraWan && (
                                <Badge
                                  variant="secondary"
                                  className="mr-1 text-[10px] px-1 py-0"
                                >
                                  LoRaWAN
                                </Badge>
                              )}
                              <span className="text-muted-foreground text-xs">
                                ({s.serviceType})
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setCreateInputSvcs((prev) =>
                          prev.filter((e) => e._key !== entry._key),
                        )
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Output services */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Output services</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    createLoadingSvcs ||
                    (createOutputSvcs.length > 0 &&
                      !createOutputSvcs[createOutputSvcs.length - 1].serviceId)
                  }
                  onClick={() =>
                    setCreateOutputSvcs((prev) => [
                      ...prev,
                      {
                        _key: Date.now() + Math.random(),
                        serviceId: "",
                        topicTemplate: "",
                      },
                    ])
                  }
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} className="mr-1" />
                  Add
                </Button>
              </div>
              {createOutputSvcs.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No output services — add one above.
                </p>
              ) : (
                createOutputSvcs.map((entry) => (
                  <div key={entry._key} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Select
                        value={entry.serviceId}
                        onValueChange={(v) =>
                          setCreateOutputSvcs((prev) =>
                            prev.map((e) =>
                              e._key === entry._key
                                ? { ...e, serviceId: v }
                                : e,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select service…" />
                        </SelectTrigger>
                        <SelectContent>
                          {createAvailServices
                            .filter((s) => s.serviceType?.startsWith("output."))
                            .map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                {s.name}{" "}
                                <span className="text-muted-foreground text-xs">
                                  ({s.serviceType})
                                </span>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setCreateOutputSvcs((prev) =>
                            prev.filter((e) => e._key !== entry._key),
                          )
                        }
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={13} />
                      </Button>
                    </div>
                    <Input
                      value={entry.topicTemplate}
                      onChange={(e) =>
                        setCreateOutputSvcs((prev) =>
                          prev.map((ent) =>
                            ent._key === entry._key
                              ? { ...ent, topicTemplate: e.target.value }
                              : ent,
                          ),
                        )
                      }
                      placeholder="Topic template, e.g. fleet/out/{device_key} (optional)"
                      className="text-xs"
                    />
                  </div>
                ))
              )}
              {createOutputSvcs.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Use <code>{"{device_key}"}</code> as placeholder. Leave empty
                  to use the service default.
                </p>
              )}
            </div>

            {createError && (
              <p className="text-destructive text-sm">{createError}</p>
            )}
          </div>
          <SheetFooter>
            <Button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Edit Sheet ─────────────────────────────────────────────────────── */}
      <Sheet
        modal={false}
        open={showEdit}
        onOpenChange={(open) => {
          setShowEdit(open);
          if (!open) {
            setEditTarget(null);
            setEditInputSvcs([]);
            setEditOutputSvcs([]);
            setEditOriginalSvcIds(new Set());
            setEditError(null);
          }
        }}
      >
        <SheetContent
          className="w-[520px] sm:max-w-[520px] overflow-y-auto"
          hideOverlay
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle>Edit Profile</SheetTitle>
            <SheetDescription>{editTarget?.name}</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 py-4">
            {/* Name */}
            <div className="space-y-1">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label htmlFor="edit-desc">Description</Label>
              <Input
                id="edit-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>

            {/* Input services */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Input services</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    editLoadingSvcs ||
                    (editInputSvcs.length > 0 &&
                      !editInputSvcs[editInputSvcs.length - 1].serviceId)
                  }
                  onClick={() =>
                    setEditInputSvcs((prev) => [
                      ...prev,
                      {
                        _key: Date.now() + Math.random(),
                        serviceId: "",
                        topicTemplate: "",
                      },
                    ])
                  }
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} className="mr-1" />
                  Add
                </Button>
              </div>
              {editLoadingSvcs ? (
                <div className="space-y-1">
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : editInputSvcs.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No input services — add one above.
                </p>
              ) : (
                editInputSvcs.map((entry) => (
                  <div key={entry._key} className="flex items-center gap-2">
                    <Select
                      value={entry.serviceId}
                      onValueChange={(v) =>
                        setEditInputSvcs((prev) =>
                          prev.map((e) =>
                            e._key === entry._key ? { ...e, serviceId: v } : e,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select service…" />
                      </SelectTrigger>
                      <SelectContent>
                        {editAvailServices
                          .filter((s) => s.serviceType?.startsWith("input."))
                          .map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name}{" "}
                              {s.isLoraWan && (
                                <Badge
                                  variant="secondary"
                                  className="mr-1 text-[10px] px-1 py-0"
                                >
                                  LoRaWAN
                                </Badge>
                              )}
                              <span className="text-muted-foreground text-xs">
                                ({s.serviceType})
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditInputSvcs((prev) =>
                          prev.filter((e) => e._key !== entry._key),
                        )
                      }
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Output services */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Output services</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    editLoadingSvcs ||
                    (editOutputSvcs.length > 0 &&
                      !editOutputSvcs[editOutputSvcs.length - 1].serviceId)
                  }
                  onClick={() =>
                    setEditOutputSvcs((prev) => [
                      ...prev,
                      {
                        _key: Date.now() + Math.random(),
                        serviceId: "",
                        topicTemplate: "",
                      },
                    ])
                  }
                >
                  <HugeiconsIcon icon={Add01Icon} size={12} className="mr-1" />
                  Add
                </Button>
              </div>
              {editLoadingSvcs ? (
                <div className="space-y-1">
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : editOutputSvcs.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No output services — add one above.
                </p>
              ) : (
                editOutputSvcs.map((entry) => (
                  <div key={entry._key} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Select
                        value={entry.serviceId}
                        onValueChange={(v) =>
                          setEditOutputSvcs((prev) =>
                            prev.map((e) =>
                              e._key === entry._key
                                ? { ...e, serviceId: v }
                                : e,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select service…" />
                        </SelectTrigger>
                        <SelectContent>
                          {editAvailServices
                            .filter((s) => s.serviceType?.startsWith("output."))
                            .map((s) => (
                              <SelectItem key={s.id} value={String(s.id)}>
                                {s.name}{" "}
                                <span className="text-muted-foreground text-xs">
                                  ({s.serviceType})
                                </span>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditOutputSvcs((prev) =>
                            prev.filter((e) => e._key !== entry._key),
                          )
                        }
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={13} />
                      </Button>
                    </div>
                    <Input
                      value={entry.topicTemplate}
                      onChange={(e) =>
                        setEditOutputSvcs((prev) =>
                          prev.map((ent) =>
                            ent._key === entry._key
                              ? { ...ent, topicTemplate: e.target.value }
                              : ent,
                          ),
                        )
                      }
                      placeholder="Topic template, e.g. fleet/out/{device_key} (optional)"
                      className="text-xs"
                    />
                  </div>
                ))
              )}
              {editOutputSvcs.length > 0 && !editLoadingSvcs && (
                <p className="text-muted-foreground text-xs">
                  Use <code>{"{device_key}"}</code> as placeholder. Leave empty
                  to use the service default.
                </p>
              )}
            </div>

            {editError && (
              <p className="text-destructive text-sm">{editError}</p>
            )}
          </div>
          <SheetFooter>
            <Button onClick={handleEdit} disabled={saving || !editName.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Manage Services Sheet ─────────────────────────────────────────── */}
      <Sheet
        modal={false}
        open={!!expandedProfile}
        onOpenChange={(open) => {
          if (!open) setExpandedProfile(null);
        }}
      >
        <SheetContent className="w-[520px] sm:max-w-[520px]" hideOverlay>
          <SheetHeader>
            <SheetTitle>Services — {expandedProfile?.name}</SheetTitle>
            <SheetDescription>
              Add input and output services to this profile. Output adapters
              will only process devices whose application references this
              profile.
            </SheetDescription>
          </SheetHeader>

          {/* Existing services */}
          <div className="mt-4 space-y-2">
            {(expandedProfile?.services ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">No services yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Topic template</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(expandedProfile?.services ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.serviceName}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">{s.serviceType}</code>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.role === "input" ? "secondary" : "default"}
                        >
                          {s.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {s.topicTemplate ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveService(s.serviceId)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={13} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Add service form */}
          <div className="mt-6 space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Add service</p>
            <div className="space-y-1">
              <Label>Service</Label>
              <Select
                value={addServiceId}
                onValueChange={(v) => {
                  setAddServiceId(v);
                  setAddSvcError(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select service…" />
                </SelectTrigger>
                <SelectContent>
                  {availableServices.some((s) =>
                    s.serviceType.startsWith("input."),
                  ) && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Input services
                      </div>
                      {availableServices
                        .filter((s) => s.serviceType.startsWith("input."))
                        .map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name}{" "}
                            {s.isLoraWan && (
                              <Badge
                                variant="secondary"
                                className="mr-1 text-[10px] px-1 py-0"
                              >
                                LoRaWAN
                              </Badge>
                            )}
                            <span className="text-muted-foreground text-xs">
                              ({s.serviceType})
                            </span>
                          </SelectItem>
                        ))}
                    </>
                  )}
                  {availableServices.some(
                    (s) => !s.serviceType.startsWith("input."),
                  ) && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Output services
                      </div>
                      {availableServices
                        .filter((s) => !s.serviceType.startsWith("input."))
                        .map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name}{" "}
                            <span className="text-muted-foreground text-xs">
                              ({s.serviceType})
                            </span>
                          </SelectItem>
                        ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            {addSvcError && (
              <p className="text-destructive text-xs">{addSvcError}</p>
            )}
            <Button
              size="sm"
              disabled={!addServiceId || addingService}
              onClick={handleAddService}
            >
              {addingService ? "Adding…" : "Add"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Manage Devices Sheet ─────────────────────────────────────────── */}
      <Sheet
        modal={false}
        open={!!devicesProfile}
        onOpenChange={(open) => {
          if (!open) {
            setDevicesProfile(null);
            setAllOrgDevices([]);
            setAssignedDeviceIds(new Set());
            setPendingDeviceIds(new Set());
            setDeviceSearch("");
            setDeviceError(null);
            setApplySuccess(false);
            setDeviceAssignments(new Map());
          }
        }}
      >
        <SheetContent
          className="w-[520px] sm:max-w-[520px] overflow-y-auto"
          hideOverlay
        >
          <SheetHeader>
            <SheetTitle>Devices — {devicesProfile?.name}</SheetTitle>
            <SheetDescription>
              Select which devices should be routed through this profile&apos;s
              services. Checked devices will have <code>device_services</code>{" "}
              rows created or re-activated. Unchecked devices will have those
              rows removed.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            <Input
              placeholder="Search by key, model or vendor…"
              value={deviceSearch}
              onChange={(e) => setDeviceSearch(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {pendingDeviceIds.size} device
              {pendingDeviceIds.size !== 1 ? "s" : ""} selected
            </p>

            {loadingDevices ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : allOrgDevices.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No devices found in this organization.
              </p>
            ) : (
              <div className="max-h-[360px] space-y-0.5 overflow-y-auto rounded-md border p-2">
                {allOrgDevices
                  .filter((d) => {
                    if (!deviceSearch) return true;
                    const q = deviceSearch.toLowerCase();
                    return (
                      d.device_key.toLowerCase().includes(q) ||
                      d.device_model_name.toLowerCase().includes(q) ||
                      d.vendor_name.toLowerCase().includes(q)
                    );
                  })
                  .map((d) => {
                    const isAssigned = assignedDeviceIds.has(d.id);
                    const conflictProfile = !isAssigned
                      ? deviceAssignments.get(d.id)
                      : undefined;
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-1 rounded px-2 py-1.5 hover:bg-accent"
                      >
                        <label className="flex flex-1 cursor-pointer items-center gap-3">
                          <Checkbox
                            checked={pendingDeviceIds.has(d.id)}
                            onCheckedChange={(checked) => {
                              setPendingDeviceIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(d.id);
                                else next.delete(d.id);
                                return next;
                              });
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs">
                              {d.device_key}
                            </span>
                            <span className="text-muted-foreground truncate text-xs">
                              {d.vendor_name} · {d.device_model_name}
                              {!d.is_active && (
                                <span className="text-destructive">
                                  {" "}
                                  · inactive
                                </span>
                              )}
                              {conflictProfile && (
                                <span className="text-amber-500">
                                  {" "}
                                  · already in &quot;{conflictProfile}&quot;
                                </span>
                              )}
                            </span>
                          </div>
                        </label>
                        {isAssigned && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 shrink-0 p-0 text-destructive"
                            title="Remove from profile immediately"
                            onClick={async (e) => {
                              e.preventDefault();
                              await fetch(
                                `${API}/api/v1/orgs/${orgId}/integration-profiles/${devicesProfile?.id}/devices/${d.id}`,
                                {
                                  method: "DELETE",
                                  headers: {
                                    Authorization: `Bearer ${token}`,
                                  },
                                },
                              );
                              setAssignedDeviceIds((prev) => {
                                const n = new Set(prev);
                                n.delete(d.id);
                                return n;
                              });
                              setPendingDeviceIds((prev) => {
                                const n = new Set(prev);
                                n.delete(d.id);
                                return n;
                              });
                              setApplySuccess(false);
                            }}
                          >
                            <HugeiconsIcon icon={Delete02Icon} size={12} />
                          </Button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Currently assigned mirror table */}
            {assignedDeviceIds.size > 0 && (
              <div className="border-t pt-3">
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  Currently assigned ({assignedDeviceIds.size})
                </p>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1 text-xs">
                          Device Key
                        </TableHead>
                        <TableHead className="py-1 text-xs">
                          Vendor · Model
                        </TableHead>
                        <TableHead className="w-8 py-1" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allOrgDevices
                        .filter((d) => assignedDeviceIds.has(d.id))
                        .map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="py-1 font-mono text-xs">
                              {d.device_key}
                            </TableCell>
                            <TableCell className="text-muted-foreground py-1 text-xs">
                              {d.vendor_name} · {d.device_model_name}
                            </TableCell>
                            <TableCell className="py-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-destructive"
                                title="Remove immediately"
                                onClick={async () => {
                                  await fetch(
                                    `${API}/api/v1/orgs/${orgId}/integration-profiles/${devicesProfile?.id}/devices/${d.id}`,
                                    {
                                      method: "DELETE",
                                      headers: {
                                        Authorization: `Bearer ${token}`,
                                      },
                                    },
                                  );
                                  setAssignedDeviceIds((prev) => {
                                    const n = new Set(prev);
                                    n.delete(d.id);
                                    return n;
                                  });
                                  setPendingDeviceIds((prev) => {
                                    const n = new Set(prev);
                                    n.delete(d.id);
                                    return n;
                                  });
                                  setApplySuccess(false);
                                }}
                              >
                                <HugeiconsIcon icon={Delete02Icon} size={12} />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {deviceError && (
              <p className="text-destructive text-sm">{deviceError}</p>
            )}
            {applySuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Changes applied successfully.
              </p>
            )}
          </div>

          <SheetFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setDevicesProfile(null)}
              disabled={applyingDevices}
            >
              Close
            </Button>
            <Button
              onClick={handleApplyDevices}
              disabled={applyingDevices || loadingDevices}
            >
              {applyingDevices ? "Applying…" : "Apply"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirm ─────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the profile. Applications referencing it will
              lose their routing (integration_profile_id set to NULL). This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
