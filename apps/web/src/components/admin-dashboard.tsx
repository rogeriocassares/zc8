"use client";

/**
 * Admin Dashboard — 6-tab unified view
 * Tabs: Users · Orgs · Teams · Applications · Devices · Transports
 *
 * Role rules:
 *   superAdmin  – sees ALL entities across all orgs
 *   org member  – sees entities scoped to their session org
 *               (owner/admin rows include all actions; member rows are read-only)
 */

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  Building04Icon,
  CheckmarkCircle01Icon,
  ComputerTerminal01Icon,
  CpuIcon,
  Database01Icon,
  Delete02Icon,
  Edit01Icon,
  Loading03Icon,
  MoreVerticalCircle01Icon,
  RouterIcon,
  SquareIcon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import * as React from "react";
import { z } from "zod";
import { CommandsTab } from "@/components/commands-tab";
import { IntegrationProfilesTab } from "@/components/integration-profiles-tab";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import {
  type HeartbeatEvent,
  type OutputAckEvent,
  type RawIngestEvent,
  subscribeNatsRealtime,
  type TelemetryEvent,
} from "@/lib/nats-realtime";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";
const NATS_WS_URL =
  process.env.NEXT_PUBLIC_NATS_WS_URL || "ws://localhost:4223";

// ─── Colour helpers ────────────────────────────────────────────────────────────

const PLATFORM_ROLE_COLOUR: Record<string, string> = {
  superAdmin:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  user: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function platformRoleLabel(role: string): string {
  if (role === "superAdmin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "User";
}

const PLAN_COLOUR: Record<string, string> = {
  user: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  hobby: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  pro: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  premium:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  enterprise:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

const STATUS_COLOUR: Record<string, string> = {
  active:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  inactive: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  suspended:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// ─── Zod schemas (match API response shapes exactly) ──────────────────────────

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  role: z.string().optional(),
  plan: z.enum(["user", "hobby", "pro", "premium", "enterprise"]).optional(),
  avatar_url: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  email_verified: z.boolean().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  organizations: z
    .array(z.object({ id: z.number(), name: z.string() }))
    .default([]),
  teams: z.array(z.object({ id: z.number(), name: z.string() })).default([]),
});
type AdminUser = z.infer<typeof userSchema>;

const orgSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  owner_email: z.string().nullable().optional(),
});
type AdminOrg = z.infer<typeof orgSchema>;

const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  team_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  organization_id: z.number().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  owner_email: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  integration_profile_id: z.number().nullable().optional(),
});
type AdminTeam = z.infer<typeof teamSchema>;

const appSchema = z.object({
  id: z.number(),
  team_id: z.number(),
  team_name: z.string().nullable().optional(),
  organization_id: z.number().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  visibility: z.enum(["team", "org", "public"]).optional().default("team"),
  redis_cache_size: z.number().optional().default(1),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  sensor_types: z.array(z.string()).nullable().optional(),
  total_device_count: z.number().optional().default(0),
  connected_device_count: z.number().optional().default(0),
});
type AdminApp = z.infer<typeof appSchema>;

const deviceSchema = z.object({
  id: z.string(),
  device_key: z.string().nullable().optional(),
  device_type: z.string().nullable().optional(),
  eui: z.string().nullable().optional(),
  mac_address: z.string().nullable().optional(),
  vendor_name: z.string().nullable().optional(),
  device_model_name: z.string().nullable().optional(),
  device_model_code: z.string().nullable().optional(),
  organization_id: z.number().nullable().optional(),
  team_id: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  is_public: z.boolean().nullable().optional(),
  is_global: z.boolean().nullable().optional(),
  is_persistent: z.boolean().nullable().optional(),
  visibility: z.enum(["team", "org", "public"]).optional().default("team"),
  connection_status: z.string().nullable().optional(),
  last_heartbeat: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});
type AdminDevice = z.infer<typeof deviceSchema>;

const planConfigSchema = z.object({
  plan: z.string(),
  max_orgs: z.number(),
  max_teams_per_org: z.number(),
  max_apps_per_team: z.number(),
  max_devices_per_team: z.number(),
  max_members_per_org: z.number(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
});
type AdminPlanConfig = z.infer<typeof planConfigSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fullName(first?: string | null, last?: string | null, email?: string) {
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  return email || "";
}

function initials(first?: string | null, last?: string | null, email?: string) {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return (email || "??").slice(0, 2).toUpperCase();
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Generic DataTableShell ────────────────────────────────────────────────────

interface ShellProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  filterKey?: string;
  filterPlaceholder?: string;
  loading?: boolean;
  error?: string | null;
  headerRight?: React.ReactNode;
}

function DataTableShell<T>({
  columns,
  data,
  filterKey,
  filterPlaceholder,
  loading,
  error,
  headerRight,
}: ShellProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    state: { sorting, columnFilters, columnVisibility },
    initialState: { pagination: { pageSize: 25 } },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {filterKey && (
          <Input
            placeholder={filterPlaceholder ?? "Filter…"}
            value={
              (table.getColumn(filterKey)?.getFilterValue() as string) ?? ""
            }
            onChange={(e) =>
              table.getColumn(filterKey)?.setFilterValue(e.target.value)
            }
            className="max-w-xs"
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          {headerRight}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Columns{" "}
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={14}
                  className="ml-1"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(v)}
                    className="capitalize"
                  >
                    {col.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton loading rows have no unique id
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {!loading && data.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {table.getFilteredRowModel().rows.length} row
            {table.getFilteredRowModel().rows.length !== 1 ? "s" : ""} · page{" "}
            {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <HugeiconsIcon icon={ArrowLeftDoubleIcon} size={13} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={13} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <HugeiconsIcon icon={ArrowRightDoubleIcon} size={13} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: All Users ────────────────────────────────────────────────────────────

function AllUsersTab({
  token,
  isSuperAdmin,
  orgId,
  currentUserId,
}: {
  token: string;
  isSuperAdmin: boolean;
  orgId: number | null;
  currentUserId?: string;
}) {
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Plan config for member limits
  const [planConfigs, setPlanConfigs] = React.useState<AdminPlanConfig[]>([]);

  // Action state
  const [editTarget, setEditTarget] = React.useState<AdminUser | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminUser | null>(
    null,
  );
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Create state
  const [showCreate, setShowCreate] = React.useState(false);
  const [createEmail, setCreateEmail] = React.useState("");
  const [createFirstName, setCreateFirstName] = React.useState("");
  const [createLastName, setCreateLastName] = React.useState("");
  const [createPassword, setCreatePassword] = React.useState("");
  const [createRole, setCreateRole] = React.useState("user");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Edit form state
  const [editFirstName, setEditFirstName] = React.useState("");
  const [editLastName, setEditLastName] = React.useState("");
  const [editRole, setEditRole] = React.useState("");
  const [editPlan, setEditPlan] = React.useState("");
  const [editEmailVerified, setEditEmailVerified] = React.useState(false);
  const [editIsActive, setEditIsActive] = React.useState(true);

  React.useEffect(() => {
    if (editTarget) {
      setEditFirstName(editTarget.first_name ?? "");
      setEditLastName(editTarget.last_name ?? "");
      setEditRole(editTarget.role ?? "user");
      setEditPlan(editTarget.plan ?? "user");
      setEditEmailVerified(editTarget.email_verified ?? false);
      setEditIsActive(editTarget.is_active ?? true);
    }
  }, [editTarget]);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    setError(null);
    fetch(`${API}/api/v1/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        const parsed = z.array(userSchema).safeParse(json.data);
        if (parsed.success) setUsers(parsed.data);
        else {
          console.error("Users parse error:", parsed.error.flatten());
          setError("Unexpected response shape — check console");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  // Load plan configs to derive member limits
  React.useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/plan-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) {
          const parsed = z.array(planConfigSchema).safeParse(json.data);
          if (parsed.success) setPlanConfigs(parsed.data);
        }
      })
      .catch(() => {});
  }, [token]);

  async function handleCreateUser() {
    if (!createEmail || !createPassword || !createFirstName || !createLastName)
      return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch(`${API}/api/v1/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: createEmail,
          first_name: createFirstName,
          last_name: createLastName,
          password: createPassword,
          email_verified: true,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      setUsers((prev) => [
        {
          id: json.data.id,
          email: json.data.email,
          first_name: json.data.first_name,
          last_name: json.data.last_name,
          role: createRole,
          plan: "user",
          avatar_url: null,
          created_at: json.data.created_at,
          organizations: [],
          teams: [],
        },
        ...prev,
      ]);
      setShowCreate(false);
      setCreateEmail("");
      setCreateFirstName("");
      setCreateLastName("");
      setCreatePassword("");
      setCreateRole("user");
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveUser() {
    if (!editTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/v1/users/${editTarget.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: editFirstName,
          last_name: editLastName,
          role: editRole,
          plan: editPlan,
          email_verified: editEmailVerified,
          is_active: editIsActive,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "Update failed");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editTarget.id
            ? {
                ...u,
                first_name: editFirstName,
                last_name: editLastName,
                role: editRole,
                plan: editPlan as AdminUser["plan"],
                email_verified: editEmailVerified,
                is_active: editIsActive,
              }
            : u,
        ),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/v1/users/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<AdminUser>[] = React.useMemo(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
              {initials(
                row.original.first_name,
                row.original.last_name,
                row.original.email,
              )}
            </div>
            <div>
              <div className="font-medium text-sm">{row.original.email}</div>
              {(row.original.first_name || row.original.last_name) && (
                <div className="text-xs text-muted-foreground">
                  {fullName(row.original.first_name, row.original.last_name)}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Platform Role",
        cell: ({ getValue }) => {
          const v = getValue() as string | undefined;
          if (!v)
            return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <Badge
              variant="outline"
              className={`text-xs ${PLATFORM_ROLE_COLOUR[v] ?? "bg-gray-100 text-gray-700"}`}
            >
              {platformRoleLabel(v)}
            </Badge>
          );
        },
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ getValue }) => {
          const v = getValue() as string | undefined;
          if (!v)
            return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${PLAN_COLOUR[v] ?? ""}`}
            >
              {v}
            </Badge>
          );
        },
      },
      {
        id: "organizations",
        header: "Organizations",
        cell: ({ row }) => {
          const orgs = row.original.organizations;
          if (!orgs.length)
            return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {orgs.slice(0, 3).map((o) => (
                <Badge key={o.id} variant="outline" className="text-xs">
                  {o.name}
                </Badge>
              ))}
              {orgs.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{orgs.length - 3}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "teams",
        header: "Teams",
        cell: ({ row }) => {
          const ts = row.original.teams;
          if (!ts.length)
            return <span className="text-muted-foreground text-xs">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {ts.slice(0, 2).map((t) => (
                <Badge key={t.id} variant="outline" className="text-xs">
                  {t.name}
                </Badge>
              ))}
              {ts.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{ts.length - 2}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const u = row.original;
          const canDelete = isSuperAdmin && u.id !== currentUserId;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditTarget(u);
                    setShowEdit(true);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Edit
                </DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        setDeleteTarget(u);
                        setActionError(null);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        size={14}
                        className="mr-2"
                      />{" "}
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [isSuperAdmin, currentUserId],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={users}
        filterKey="email"
        filterPlaceholder="Filter by email…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            {(() => {
              // Derive member limit for the current user's plan
              const currentUser = users.find((u) => u.id === currentUserId);
              const userPlan = currentUser?.plan ?? "user";
              const config = planConfigs.find((c) => c.plan === userPlan);
              const limit = config?.max_members_per_org ?? -1;
              const orgUserCount = isSuperAdmin
                ? users.length
                : users.filter((u) =>
                    u.organizations.some((o) => o.id === orgId),
                  ).length || users.length;
              const atLimit =
                !isSuperAdmin && limit !== -1 && orgUserCount >= limit;
              return (
                <>
                  <Button
                    size="sm"
                    disabled={atLimit}
                    onClick={() => {
                      setCreateEmail("");
                      setCreateFirstName("");
                      setCreateLastName("");
                      setCreatePassword("");
                      setCreateRole("user");
                      setCreateError(null);
                      setShowCreate(true);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      size={14}
                      className="mr-1"
                    />
                    New User
                  </Button>
                  <Badge variant="secondary" className="tabular-nums">
                    {orgUserCount}
                    {!isSuperAdmin && limit !== -1 && (
                      <span className="text-muted-foreground"> / {limit}</span>
                    )}
                  </Badge>
                </>
              );
            })()}
          </div>
        }
      />

      {/* Create Sheet */}
      <Sheet open={showCreate} onOpenChange={setShowCreate}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New User</SheetTitle>
            <SheetDescription>Create a new platform user.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>First Name *</Label>
              <Input
                value={createFirstName}
                onChange={(e) => setCreateFirstName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Last Name *</Label>
              <Input
                value={createLastName}
                onChange={(e) => setCreateLastName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Password *</Label>
              <Input
                type="password"
                placeholder="Min. 8 characters"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Platform Role</Label>
              <Select value={createRole} onValueChange={setCreateRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="superAdmin">Super Admin</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={
                creating ||
                !createEmail ||
                !createPassword ||
                !createFirstName ||
                !createLastName
              }
            >
              {creating && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create User
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit User</SheetTitle>
            <SheetDescription>{editTarget?.email}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>First Name</Label>
              <Input
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Last Name</Label>
              <Input
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
              />
            </div>
            {isSuperAdmin && (
              <div className="grid gap-1.5">
                <Label>Platform Role</Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="superAdmin">Super Admin</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Plan</Label>
              <Select value={editPlan} onValueChange={setEditPlan}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {["user", "hobby", "pro", "premium", "enterprise"].map(
                      (p) => (
                        <SelectItem key={p} value={p} className="capitalize">
                          {p}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit-email-verified"
                checked={editEmailVerified}
                onChange={(e) => setEditEmailVerified(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <Label htmlFor="edit-email-verified">Email Verified</Label>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={editIsActive ? "active" : "inactive"}
                onValueChange={(v) => setEditIsActive(v === "active")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveUser} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg border shadow-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="font-semibold text-base">Delete User?</h2>
            <p className="text-sm text-muted-foreground">
              Permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteTarget.email}
              </span>
              ? This cannot be undone.
            </p>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteUser}
                disabled={deleting}
              >
                {deleting && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="mr-2 animate-spin"
                  />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Tab: All Orgs ─────────────────────────────────────────────────────────────

function AllOrgsTab({
  token,
  isSuperAdmin,
}: {
  token: string;
  isSuperAdmin: boolean;
}) {
  const [orgs, setOrgs] = React.useState<AdminOrg[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Action state
  const [editTarget, setEditTarget] = React.useState<AdminOrg | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminOrg | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Create state
  const [showCreateOrg, setShowCreateOrg] = React.useState(false);
  const [createOrgName, setCreateOrgName] = React.useState("");
  const [createOrgDescription, setCreateOrgDescription] = React.useState("");
  const [creatingOrg, setCreatingOrg] = React.useState(false);
  const [createOrgError, setCreateOrgError] = React.useState<string | null>(
    null,
  );

  // Edit form state
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editStatus, setEditStatus] = React.useState("");

  React.useEffect(() => {
    if (editTarget) {
      setEditName(editTarget.name);
      setEditDescription(editTarget.description ?? "");
      setEditStatus(editTarget.status ?? "active");
    }
  }, [editTarget]);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    fetch(`${API}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        const parsed = z.array(orgSchema).safeParse(json.data);
        if (parsed.success) setOrgs(parsed.data);
        else {
          console.error("Orgs parse error:", parsed.error.flatten());
          setError("Unexpected response shape — check console");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleCreateOrg() {
    if (!createOrgName.trim()) return;
    setCreatingOrg(true);
    setCreateOrgError(null);
    try {
      const r = await fetch(`${API}/api/v1/organizations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: createOrgName,
          slug: toSlug(createOrgName),
          description: createOrgDescription || undefined,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      setOrgs((prev) => [
        {
          id: json.data.id,
          name: json.data.name,
          slug: json.data.slug,
          description: json.data.description,
          plan: json.data.plan,
          status: json.data.status,
          owner_email: null,
        },
        ...prev,
      ]);
      setShowCreateOrg(false);
      setCreateOrgName("");
      setCreateOrgDescription("");
    } catch (e: unknown) {
      setCreateOrgError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingOrg(false);
    }
  }

  async function handleSaveOrg() {
    if (!editTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/v1/organizations/${editTarget.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          status: editStatus,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "Update failed");
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === editTarget.id
            ? {
                ...o,
                name: editName,
                description: editDescription,
                status: editStatus,
              }
            : o,
        ),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteOrg() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/v1/organizations/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setOrgs((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<AdminOrg>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.slug}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "owner_email",
        header: "Owner",
        cell: ({ getValue }) => (
          <span className="text-sm">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "";
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${STATUS_COLOUR[v] ?? ""}`}
            >
              {v || "—"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground line-clamp-1">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const o = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditTarget(o);
                    setShowEdit(true);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Edit
                </DropdownMenuItem>
                {isSuperAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        setDeleteTarget(o);
                        setActionError(null);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        size={14}
                        className="mr-2"
                      />{" "}
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [isSuperAdmin],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={orgs}
        filterKey="name"
        filterPlaceholder="Filter by name…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateOrgName("");
                setCreateOrgDescription("");
                setCreateOrgError(null);
                setShowCreateOrg(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              New Organization
            </Button>
            <Badge variant="secondary" className="tabular-nums">
              {orgs.length}
            </Badge>
          </div>
        }
      />

      {/* Create Org Sheet */}
      <Sheet open={showCreateOrg} onOpenChange={setShowCreateOrg}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Organization</SheetTitle>
            <SheetDescription>Create a new organization.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="My Organization"
                value={createOrgName}
                onChange={(e) => setCreateOrgName(e.target.value)}
              />
              {createOrgName && (
                <p className="text-xs text-muted-foreground">
                  Slug: {toSlug(createOrgName)}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={createOrgDescription}
                onChange={(e) => setCreateOrgDescription(e.target.value)}
              />
            </div>
            {createOrgError && (
              <p className="text-sm text-destructive">{createOrgError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreateOrg(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateOrg}
              disabled={creatingOrg || !createOrgName.trim()}
            >
              {creatingOrg && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create Organization
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Organization</SheetTitle>
            <SheetDescription>{editTarget?.slug}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {["active", "inactive", "suspended"].map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveOrg} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg border shadow-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="font-semibold text-base">Delete Organization?</h2>
            <p className="text-sm text-muted-foreground">
              Permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteTarget.name}
              </span>
              ? This cannot be undone.
            </p>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteOrg}
                disabled={deleting}
              >
                {deleting && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="mr-2 animate-spin"
                  />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Tab: All Teams ────────────────────────────────────────────────────────────

function AllTeamsTab({
  token,
  isSuperAdmin,
  orgId,
}: {
  token: string;
  isSuperAdmin: boolean;
  orgId: number | null;
}) {
  const [teams, setTeams] = React.useState<AdminTeam[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Orgs list for create form selector
  const [orgsList, setOrgsList] = React.useState<AdminOrg[]>([]);

  // Action state
  const [editTarget, setEditTarget] = React.useState<AdminTeam | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminTeam | null>(
    null,
  );
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Create state
  const [showCreateTeam, setShowCreateTeam] = React.useState(false);
  const [createTeamName, setCreateTeamName] = React.useState("");
  const [createTeamDescription, setCreateTeamDescription] = React.useState("");
  const [createTeamOrgId, setCreateTeamOrgId] = React.useState("");
  const [createTeamType, setCreateTeamType] = React.useState("department");
  const [creatingTeam, setCreatingTeam] = React.useState(false);
  const [createTeamError, setCreateTeamError] = React.useState<string | null>(
    null,
  );

  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editStatus, setEditStatus] = React.useState("");
  const [editIntegrationProfileId, setEditIntegrationProfileId] =
    React.useState("");
  const [profilesList, setProfilesList] = React.useState<
    { id: number; name: string }[]
  >([]);

  React.useEffect(() => {
    if (editTarget) {
      setEditName(editTarget.name);
      setEditDescription(editTarget.description ?? "");
      setEditStatus(editTarget.status ?? "active");
      setEditIntegrationProfileId(
        String(editTarget.integration_profile_id ?? ""),
      );
    }
  }, [editTarget]);

  const loadTeams = React.useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    // superAdmin gets global listing; others get their org's teams
    // refreshKey is appended as a cache-buster to force a new network request
    const bust = refreshKey > 0 ? `?_r=${refreshKey}` : "";
    const url = isSuperAdmin
      ? `${API}/api/v1/teams${bust}`
      : orgId
        ? `${API}/api/v1/orgs/${orgId}/teams${bust}`
        : null;
    if (!url) {
      setLoading(false);
      return;
    }
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        const parsed = z.array(teamSchema).safeParse(json.data);
        if (parsed.success) setTeams(parsed.data);
        else {
          console.error("Teams parse error:", parsed.error.flatten());
          setError("Unexpected response shape — check console");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, isSuperAdmin, orgId, refreshKey]);

  React.useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // Load orgs for create form (superAdmin needs full list; non-superAdmin fetches their own org)
  React.useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) {
          const parsed = z.array(orgSchema).safeParse(json.data);
          if (parsed.success) {
            setOrgsList(parsed.data);
            // Pre-select the user's org if non-superAdmin
            if (!isSuperAdmin && orgId) {
              setCreateTeamOrgId(String(orgId));
            }
          }
        }
      })
      .catch(() => {});
  }, [token, isSuperAdmin, orgId]);

  // Load integration profiles for the profile picker
  React.useEffect(() => {
    if (!token || !orgId) return;
    fetch(`${API}/api/v1/orgs/${orgId}/integration-profiles`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success && Array.isArray(json.data)) {
          setProfilesList(
            json.data.map((p: { id: number; name: string }) => ({
              id: p.id,
              name: p.name,
            })),
          );
        }
      })
      .catch(() => {});
  }, [token, orgId]);

  async function handleCreateTeam() {
    const effectiveOrgId = Number(createTeamOrgId);
    if (!createTeamName.trim() || !effectiveOrgId) return;
    setCreatingTeam(true);
    setCreateTeamError(null);
    try {
      const r = await fetch(`${API}/api/v1/orgs/${effectiveOrgId}/teams`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: createTeamName,
          slug: toSlug(createTeamName),
          description: createTeamDescription || undefined,
          team_type: createTeamType,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      const orgName =
        orgsList.find((o) => o.id === effectiveOrgId)?.name ?? null;
      setTeams((prev) => [
        {
          id: json.data.id,
          name: json.data.name,
          slug: json.data.slug,
          description: json.data.description,
          team_type: json.data.teamType ?? createTeamType,
          status: json.data.status,
          organization_id: effectiveOrgId,
          organization_name: orgName,
          owner_email: null,
          created_at: json.data.createdAt ?? new Date().toISOString(),
        },
        ...prev,
      ]);
      setShowCreateTeam(false);
      setCreateTeamName("");
      setCreateTeamDescription("");
      setCreateTeamType("department");
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setCreateTeamError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleSaveTeam() {
    if (!editTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      const orgIdForEdit = editTarget.organization_id;
      if (!orgIdForEdit) throw new Error("Team has no organization");
      const r = await fetch(
        `${API}/api/v1/orgs/${orgIdForEdit}/teams/${editTarget.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editName,
            description: editDescription,
            status: editStatus,
            integration_profile_id: editIntegrationProfileId
              ? Number(editIntegrationProfileId)
              : null,
          }),
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "Update failed");
      setTeams((prev) =>
        prev.map((t) =>
          t.id === editTarget.id
            ? {
                ...t,
                name: editName,
                description: editDescription,
                status: editStatus,
                integration_profile_id: editIntegrationProfileId
                  ? Number(editIntegrationProfileId)
                  : null,
              }
            : t,
        ),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTeam() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const orgIdForDelete = deleteTarget.organization_id;
      if (!orgIdForDelete) throw new Error("Team has no organization");
      const r = await fetch(
        `${API}/api/v1/orgs/${orgIdForDelete}/teams/${deleteTarget.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTeams((prev) => prev.filter((t) => t.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<AdminTeam>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.slug}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "organization_name",
        header: "Organization",
        cell: ({ getValue }) => (
          <span className="text-sm">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "owner_email",
        header: "Owner",
        cell: ({ getValue }) => (
          <span className="text-sm">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "team_type",
        header: "Type",
        cell: ({ getValue }) => (
          <span className="text-xs capitalize text-muted-foreground">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "";
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${STATUS_COLOUR[v] ?? ""}`}
            >
              {v || "—"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditTarget(t);
                    setShowEdit(true);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    setDeleteTarget(t);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={14}
                    className="mr-2"
                  />{" "}
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={teams}
        filterKey="name"
        filterPlaceholder="Filter by name…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateTeamName("");
                setCreateTeamDescription("");
                setCreateTeamType("department");
                setCreateTeamError(null);
                if (!isSuperAdmin && orgId) setCreateTeamOrgId(String(orgId));
                setShowCreateTeam(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              New Team
            </Button>
            <Badge variant="secondary" className="tabular-nums">
              {teams.length}
            </Badge>
          </div>
        }
      />

      {/* Create Team Sheet */}
      <Sheet open={showCreateTeam} onOpenChange={setShowCreateTeam}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Team</SheetTitle>
            <SheetDescription>
              Create a new team within an organization.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Organization *</Label>
              <Select
                value={createTeamOrgId}
                onValueChange={setCreateTeamOrgId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select organization…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {orgsList.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="My Team"
                value={createTeamName}
                onChange={(e) => setCreateTeamName(e.target.value)}
              />
              {createTeamName && (
                <p className="text-xs text-muted-foreground">
                  Slug: {toSlug(createTeamName)}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={createTeamDescription}
                onChange={(e) => setCreateTeamDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Team Type</Label>
              <Select value={createTeamType} onValueChange={setCreateTeamType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {["department", "project", "squad", "other"].map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {createTeamError && (
              <p className="text-sm text-destructive">{createTeamError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreateTeam(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateTeam}
              disabled={
                creatingTeam || !createTeamName.trim() || !createTeamOrgId
              }
            >
              {creatingTeam && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create Team
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Team</SheetTitle>
            <SheetDescription>{editTarget?.slug}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {["active", "inactive", "archived"].map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Integration Profile</Label>
              <Select
                value={editIntegrationProfileId || "__none__"}
                onValueChange={(v) =>
                  setEditIntegrationProfileId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (unrouted)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none__">None</SelectItem>
                    {profilesList.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTeam} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg border shadow-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="font-semibold text-base">Delete Team?</h2>
            <p className="text-sm text-muted-foreground">
              Permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteTarget.name}
              </span>
              ? This cannot be undone.
            </p>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteTeam}
                disabled={deleting}
              >
                {deleting && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="mr-2 animate-spin"
                  />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Live Messages Panel ──────────────────────────────────────────────────────
//
// Connects to the WebSocket realtime bridge and streams incoming telemetry
// into a bounded rolling table. The WS auto-subscribes to the full org subject
// (telemetry.realtime.{org_id}.>) on connect; optionally scope to a team.
//
// Redis key reference (written by services/fanout):
//   device:{device_key}:latest           — HASH, last field values + _ts
//   device:{device_key}:history:{field}  — LIST, last N float values per field
//
// NATS Core subjects (published by services/fanout):
//   telemetry.realtime.{org_id}.{team_id}.{device_key}  — single device
//   telemetry.realtime.{org_id}.{team_id}.>             — all devices in team
//   telemetry.realtime.{org_id}.>                       — all devices in org

/** Format a Unix-seconds timestamp as UTC string. Returns "—" for invalid/missing values. */
function safeUtc(tsSec: number | undefined | null): string {
  if (tsSec == null || !isFinite(tsSec) || tsSec <= 0) return "—";
  const d = new Date(tsSec * 1000);
  if (isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19);
}

type TelemetryRow = {
  id: string;
  ts: number;
  kind: "telemetry";
  deviceKey: string;
  fields: Record<string, number>;
};

type HeartbeatRow = {
  id: string;
  ts: number;
  kind: "heartbeat";
  serviceId: number;
  serviceType: string;
  teamName: string;
  isConnected?: boolean;
  isRunning?: boolean;
  broker?: string;
  msgCount: number;
  errCount: number;
};

type RawIngestRow = {
  id: string;
  ts: number;
  kind: "raw";
  deviceKey: string;
  topic: string;
  payloadHex: string;
  payloadSize: number;
};

type OutputAckRow = {
  id: string;
  ts: number;
  kind: "output_ack";
  serviceId: number;
  serviceType: string;
  teamId: number;
  deviceKey?: string;
  count: number;
};

type LiveRow = TelemetryRow | HeartbeatRow | RawIngestRow | OutputAckRow;

function LiveMessagesPanel({
  token,
  orgId,
  teamId,
  mode = "all",
  onTelemetryEvent,
  onHeartbeatEvent,
}: {
  token: string;
  orgId: number | null;
  teamId?: number;
  /** Which NATS subject / event types to subscribe to. Default "all". */
  mode?:
    | "all"
    | "telemetry"
    | "heartbeat"
    | "device"
    | "application"
    | "integration";
  /** Called for every device telemetry event (for parent last-seen tracking). */
  onTelemetryEvent?: (event: TelemetryEvent) => void;
  /** Called for every heartbeat/tombstone event (for parent status tracking). */
  onHeartbeatEvent?: (event: HeartbeatEvent) => void;
}) {
  const [rows, setRows] = React.useState<LiveRow[]>([]);
  const [rowLimit, setRowLimit] = React.useState(20);
  const rowLimitRef = React.useRef(20);
  const [connected, setConnected] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  // Keep ref in sync so the WS callback always reads the latest limit
  React.useEffect(() => {
    rowLimitRef.current = rowLimit;
    setRows((prev) => prev.slice(0, rowLimit));
  }, [rowLimit]);

  React.useEffect(() => {
    if (!token) return;

    // Use a cancelled flag to handle Strict Mode's double-invocation:
    // subscribeNatsRealtime is async — if the cleanup runs before the promise
    // resolves, cleanup is still null and the connection leaks (causing duplicate
    // messages). The cancelled flag ensures we call fn() immediately in that case.
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    subscribeNatsRealtime({
      wsUrl: NATS_WS_URL,
      token,
      orgId,
      teamId,
      mode,
      onMessage: (event) => {
        onTelemetryEvent?.(event);
        setRows((prev) =>
          [
            {
              id: `${event.ts}-${event.device_key}-${Math.random().toString(36).slice(2)}`,
              ts: event.ts,
              kind: "telemetry",
              deviceKey: String(event.device_key),
              fields: event.fields,
            } satisfies TelemetryRow,
            ...prev,
          ].slice(0, rowLimitRef.current),
        );
      },
      onRawIngest: (raw: RawIngestEvent) => {
        setRows((prev) =>
          [
            {
              id: `raw-${raw.ts}-${raw.device_key}-${Math.random().toString(36).slice(2)}`,
              ts: raw.ts,
              kind: "raw",
              deviceKey: String(raw.device_key),
              topic: raw.topic,
              payloadHex: raw.payload_hex,
              payloadSize: raw.payload_size,
            } satisfies RawIngestRow,
            ...prev,
          ].slice(0, rowLimitRef.current),
        );
      },
      onOutputAck: (ack: OutputAckEvent) => {
        setRows((prev) =>
          [
            {
              id: `ack-${ack.ts}-${ack.service_id}-${Math.random().toString(36).slice(2)}`,
              ts: ack.ts,
              kind: "output_ack",
              serviceId: ack.service_id,
              serviceType: ack.service_type,
              teamId: ack.team_id,
              deviceKey:
                ack.device_key !== undefined
                  ? String(ack.device_key)
                  : undefined,
              count: ack.count,
            } satisfies OutputAckRow,
            ...prev,
          ].slice(0, rowLimitRef.current),
        );
      },
      onHeartbeat: (hb: HeartbeatEvent) => {
        onHeartbeatEvent?.(hb);
        setRows((prev) =>
          [
            {
              id: `hb-${hb.service_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              ts: Math.floor(Date.now() / 1000),
              kind: "heartbeat",
              serviceId: hb.service_id,
              serviceType: hb.service_type,
              teamName: hb.team_name,
              isConnected: hb.is_connected,
              isRunning: hb.is_running,
              broker: hb.broker,
              msgCount: hb.message_count,
              errCount: hb.error_count,
            } satisfies HeartbeatRow,
            ...prev,
          ].slice(0, rowLimitRef.current),
        );
      },
      onConnected: () => setConnected(true),
      onDisconnected: () => setConnected(false),
    }).then((fn) => {
      if (cancelled) {
        fn(); // effect was already cleaned up before the promise resolved
      } else {
        cleanup = fn;
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [token, orgId, teamId, mode]);

  // Pre-load last messages from JetStream replay so the panel shows
  // historical data immediately instead of waiting for the next live event.
  React.useEffect(() => {
    if (!token || mode === "heartbeat" || mode === "integration") return; // these modes have no decoded-telemetry history
    let alive = true;

    fetch(`${API}/api/v1/telemetry/recent?limit=${rowLimitRef.current}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body: { messages: TelemetryEvent[] }) => {
        if (!alive || !Array.isArray(body.messages)) return;
        // The TELEMETRY_REALTIME stream contains mixed event types (heartbeats,
        // raw_ingest, output_ack). Only keep plain decoded telemetry — those
        // have no event_type field and a numeric device_key.
        const preloaded: TelemetryRow[] = body.messages
          .filter(
            (event) =>
              !(event as unknown as { event_type?: string }).event_type &&
              typeof event.device_key === "number" &&
              typeof event.ts === "number" &&
              event.ts > 0,
          )
          .map((event) => ({
            id: `pre-${event.ts}-${event.device_key}-${Math.random().toString(36).slice(2)}`,
            ts: event.ts,
            kind: "telemetry" as const,
            deviceKey: String(event.device_key),
            fields: event.fields ?? {},
          }));
        if (preloaded.length === 0) return;
        // Merge pre-loaded rows behind any live rows that may have already arrived
        setRows((prev) => {
          if (prev.length >= rowLimitRef.current) return prev; // live rows already filled
          return [...prev, ...preloaded].slice(0, rowLimitRef.current);
        });
      })
      .catch(() => {
        /* stream not ready or network error — ignore */
      });

    return () => {
      alive = false;
    };
  }, [token, orgId, teamId, mode]);

  return (
    <div className="mt-4 border rounded-lg overflow-hidden">
      {/* Collapsible header — expand toggle on left, controls on right */}
      <div className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 transition-colors ${
              connected ? "bg-green-500" : "bg-muted-foreground/40"
            }`}
          />
          <span className="text-sm font-medium">Live Messages</span>
          {rows.length > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {rows.length}
            </Badge>
          )}
          <HugeiconsIcon
            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            size={14}
            className="text-muted-foreground ml-1"
          />
        </button>
        <div className="flex items-center gap-2">
          <Select
            value={String(rowLimit)}
            onValueChange={(v) => setRowLimit(Number(v))}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setRows([])}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Messages table — only rendered when expanded */}
      {expanded && (
        <div className="border-t overflow-x-auto max-h-72 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-40 text-xs py-2">Time (UTC)</TableHead>
                <TableHead className="w-[120px] text-xs py-2">Source</TableHead>
                <TableHead className="text-xs py-2">Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center text-xs text-muted-foreground py-8"
                  >
                    {connected
                      ? "Waiting for incoming messages…"
                      : "Connecting to NATS realtime stream…"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) =>
                  row.kind === "heartbeat" ? (
                    <TableRow
                      key={row.id}
                      className="text-xs bg-blue-50/40 dark:bg-blue-950/20"
                    >
                      <TableCell className="font-mono py-1.5 text-muted-foreground whitespace-nowrap">
                        {safeUtc(row.ts)}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-blue-700 dark:text-blue-400">
                            ♥ {row.serviceType}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {row.teamName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono py-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          <span
                            className={
                              (row.isConnected ?? row.isRunning)
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-500"
                            }
                          >
                            {(row.isConnected ?? row.isRunning)
                              ? "● online"
                              : "● offline"}
                          </span>
                          <span className="text-muted-foreground">
                            ↑{row.msgCount} / ✗{row.errCount}
                          </span>
                          {row.broker && (
                            <span className="text-muted-foreground">
                              {row.broker}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : row.kind === "raw" ? (
                    <TableRow
                      key={row.id}
                      className="text-xs bg-amber-50/40 dark:bg-amber-950/20"
                    >
                      <TableCell className="font-mono py-1.5 text-muted-foreground whitespace-nowrap">
                        {safeUtc(row.ts)}
                      </TableCell>
                      <TableCell className="font-mono py-1.5 font-medium text-amber-700 dark:text-amber-400">
                        {row.deviceKey}
                      </TableCell>
                      <TableCell className="font-mono py-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span className="text-amber-600 dark:text-amber-400">
                            ⚡ raw
                          </span>
                          <span>{row.topic}</span>
                          <span>{row.payloadSize}B</span>
                          <span className="truncate max-w-xs">
                            {row.payloadHex.slice(0, 32)}
                            {row.payloadHex.length > 32 ? "…" : ""}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : row.kind === "output_ack" ? (
                    <TableRow
                      key={row.id}
                      className="text-xs bg-violet-50/40 dark:bg-violet-950/20"
                    >
                      <TableCell className="font-mono py-1.5 text-muted-foreground whitespace-nowrap">
                        {safeUtc(row.ts)}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-violet-700 dark:text-violet-400">
                            ⬆ {row.serviceType}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono py-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                          <span className="text-violet-600 dark:text-violet-400">
                            ✓ {row.count} written
                          </span>
                          {row.deviceKey && <span>device {row.deviceKey}</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={row.id} className="text-xs">
                      <TableCell className="font-mono py-1.5 text-muted-foreground whitespace-nowrap">
                        {safeUtc(row.ts)}
                      </TableCell>
                      <TableCell className="font-mono py-1.5 font-medium">
                        {row.deviceKey}
                      </TableCell>
                      <TableCell className="font-mono py-1.5">
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(row.fields)
                            .slice(0, 8)
                            .map(([k, v]) => (
                              <span key={k} className="text-muted-foreground">
                                <span className="text-foreground">{k}</span>=
                                {typeof v === "number"
                                  ? v.toFixed(4).replace(/\.?0+$/, "")
                                  : String(v)}
                              </span>
                            ))}
                          {Object.keys(row.fields).length > 8 && (
                            <span className="text-muted-foreground/60">
                              +{Object.keys(row.fields).length - 8} more
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: All Applications ─────────────────────────────────────────────────────

function AllAppsTab({
  token,
  isSuperAdmin,
  orgId,
}: {
  token: string;
  isSuperAdmin: boolean;
  orgId: number | null;
}) {
  const [apps, setApps] = React.useState<AdminApp[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Teams list for create form
  const [teamsList, setTeamsList] = React.useState<AdminTeam[]>([]);

  // Available sensor types (from device models)
  const [availableSensorTypes, setAvailableSensorTypes] = React.useState<
    string[]
  >([]);
  // Sensor types subscribed by the app being edited
  const [editSensorTypes, setEditSensorTypes] = React.useState<
    { sensor_type: string; visibility: "team" | "org" | "public" }[]
  >([]);
  const [sensorTypeToAdd, setSensorTypeToAdd] = React.useState("");
  const [sensorTypeVisibility, setSensorTypeVisibility] = React.useState<
    "team" | "org" | "public"
  >("team");
  const [sensorTypeError, setSensorTypeError] = React.useState<string | null>(
    null,
  );
  // Matched devices for the app being edited
  const [matchedDevices, setMatchedDevices] = React.useState<
    {
      device_id: string;
      device_key: string;
      device_type: string;
      vendor_name: string;
      model_name: string;
      sensor_type: string;
      sensor_unit: string | null;
      is_active: boolean;
      connection_status: string | null;
      last_heartbeat: string | null;
    }[]
  >([]);
  const [loadingMatched, setLoadingMatched] = React.useState(false);

  // Action state
  const [editTarget, setEditTarget] = React.useState<AdminApp | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminApp | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Create state
  const [showCreateApp, setShowCreateApp] = React.useState(false);
  const [createAppName, setCreateAppName] = React.useState("");
  const [createAppDescription, setCreateAppDescription] = React.useState("");
  const [createAppVisibility, setCreateAppVisibility] = React.useState<
    "team" | "org" | "public"
  >("team");
  const [createAppRedisCacheSize, setCreateAppRedisCacheSize] =
    React.useState(1);
  const [createAppTeamId, setCreateAppTeamId] = React.useState("");
  const [creatingApp, setCreatingApp] = React.useState(false);
  const [createAppError, setCreateAppError] = React.useState<string | null>(
    null,
  );

  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editStatus, setEditStatus] = React.useState("");
  const [editVisibility, setEditVisibility] = React.useState<
    "team" | "org" | "public"
  >("team");
  const [editRedisCacheSize, setEditRedisCacheSize] = React.useState(1);

  React.useEffect(() => {
    if (editTarget) {
      setEditName(editTarget.name);
      setEditDescription(editTarget.description ?? "");
      setEditStatus(editTarget.status ?? "active");
      setEditVisibility(
        (editTarget.visibility ?? "team") as "team" | "org" | "public",
      );
      setEditRedisCacheSize(editTarget.redis_cache_size ?? 1);
      setSensorTypeToAdd("");
      setSensorTypeError(null);
      setMatchedDevices([]);
      // Load current sensor subscriptions for this app
      fetch(
        `${API}/api/v1/orgs/${editTarget.organization_id}/teams/${editTarget.team_id}/applications/${editTarget.id}/sensor-types`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then(async (r) => {
          if (!r.ok) return;
          const json = await r.json();
          if (json.success)
            setEditSensorTypes(
              json.data.map(
                (s: { sensor_type: string; visibility?: string }) => ({
                  sensor_type: s.sensor_type,
                  visibility: (s.visibility ?? "team") as
                    | "team"
                    | "org"
                    | "public",
                }),
              ),
            );
        })
        .catch(() => {});
      // Load matched devices
      setLoadingMatched(true);
      fetch(
        `${API}/api/v1/orgs/${editTarget.organization_id}/teams/${editTarget.team_id}/applications/${editTarget.id}/matched-devices`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
        .then(async (r) => {
          if (!r.ok) return;
          const json = await r.json();
          if (json.success) setMatchedDevices(json.data);
        })
        .catch(() => {})
        .finally(() => setLoadingMatched(false));
    }
  }, [editTarget, token]);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    const url = isSuperAdmin
      ? `${API}/api/v1/applications`
      : orgId
        ? `${API}/api/v1/applications?org_id=${orgId}`
        : null;
    if (!url) {
      setLoading(false);
      return;
    }
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        const parsed = z.array(appSchema).safeParse(json.data);
        if (parsed.success) setApps(parsed.data);
        else {
          console.error("Apps parse error:", parsed.error.flatten());
          setError("Unexpected response shape — check console");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, isSuperAdmin, orgId]);

  // Load teams for create form
  React.useEffect(() => {
    if (!token) return;
    const url = isSuperAdmin
      ? `${API}/api/v1/teams`
      : orgId
        ? `${API}/api/v1/orgs/${orgId}/teams`
        : null;
    if (!url) return;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) {
          const parsed = z.array(teamSchema).safeParse(json.data);
          if (parsed.success) setTeamsList(parsed.data);
        }
      })
      .catch(() => {});
  }, [token, isSuperAdmin, orgId]);

  // Load available sensor types (from device models)
  React.useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/sensor-types`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) setAvailableSensorTypes(json.data as string[]);
      })
      .catch(() => {});
  }, [token]);

  async function handleCreateApp() {
    const effectiveTeamId = Number(createAppTeamId);
    if (!createAppName.trim() || !effectiveTeamId) return;
    const team = teamsList.find((t) => t.id === effectiveTeamId);
    const effectiveOrgId = team?.organization_id;
    if (!effectiveOrgId) {
      setCreateAppError("Selected team has no associated organization.");
      return;
    }
    setCreatingApp(true);
    setCreateAppError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${effectiveOrgId}/teams/${effectiveTeamId}/applications`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: createAppName,
            slug: toSlug(createAppName),
            description: createAppDescription || undefined,
            visibility: createAppVisibility,
            redis_cache_size: createAppRedisCacheSize,
          }),
        },
      );
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      setApps((prev) => [
        {
          id: json.data.id,
          team_id: effectiveTeamId,
          team_name: team?.name ?? undefined,
          organization_id: effectiveOrgId,
          organization_name: team?.organization_name ?? null,
          name: json.data.name,
          slug: json.data.slug,
          description: json.data.description,
          status: json.data.status,
          visibility: (json.data.visibility ?? createAppVisibility) as
            | "team"
            | "org"
            | "public",
          redis_cache_size: json.data.redisCacheSize ?? createAppRedisCacheSize,
          total_device_count: 0,
          connected_device_count: 0,
          created_by: null,
          created_at: json.data.createdAt ?? new Date().toISOString(),
          updated_at: null,
        },
        ...prev,
      ]);
      setShowCreateApp(false);
      setCreateAppName("");
      setCreateAppDescription("");
      setCreateAppVisibility("team");
      setCreateAppRedisCacheSize(1);
      setCreateAppTeamId("");
    } catch (e: unknown) {
      setCreateAppError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingApp(false);
    }
  }

  function refetchMatchedDevices(target: typeof editTarget) {
    if (!target) return;
    setLoadingMatched(true);
    fetch(
      `${API}/api/v1/orgs/${target.organization_id}/teams/${target.team_id}/applications/${target.id}/matched-devices`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) setMatchedDevices(json.data);
      })
      .catch(() => {})
      .finally(() => setLoadingMatched(false));
  }

  async function handleAddSensorType() {
    if (!editTarget || !sensorTypeToAdd.trim()) return;
    setSensorTypeError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${editTarget.organization_id}/teams/${editTarget.team_id}/applications/${editTarget.id}/sensor-types`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sensor_type: sensorTypeToAdd.trim().toLowerCase(),
            visibility: sensorTypeVisibility,
          }),
        },
      );
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Failed to add");
      const st = json.data.sensor_type as string;
      const vis = (json.data.visibility ?? sensorTypeVisibility) as
        | "team"
        | "org"
        | "public";
      setEditSensorTypes((prev) =>
        [...prev, { sensor_type: st, visibility: vis }].sort((a, b) =>
          a.sensor_type.localeCompare(b.sensor_type),
        ),
      );
      setSensorTypeToAdd("");
      setSensorTypeVisibility("team");
      refetchMatchedDevices(editTarget);
    } catch (e: unknown) {
      setSensorTypeError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemoveSensorType(sensorType: string) {
    if (!editTarget) return;
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${editTarget.organization_id}/teams/${editTarget.team_id}/applications/${editTarget.id}/sensor-types/${encodeURIComponent(sensorType)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEditSensorTypes((prev) =>
        prev.filter((s) => s.sensor_type !== sensorType),
      );
      refetchMatchedDevices(editTarget);
    } catch {
      // silently ignore
    }
  }

  async function handleUpdateSensorTypeVisibility(
    sensorType: string,
    visibility: "team" | "org" | "public",
  ) {
    if (!editTarget) return;
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${editTarget.organization_id}/teams/${editTarget.team_id}/applications/${editTarget.id}/sensor-types/${encodeURIComponent(sensorType)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ visibility }),
        },
      );
      if (!r.ok) return;
      setEditSensorTypes((prev) =>
        prev.map((s) =>
          s.sensor_type === sensorType ? { ...s, visibility } : s,
        ),
      );
    } catch {
      // silently ignore
    }
  }

  async function handleSaveApp() {
    if (!editTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${editTarget.organization_id}/teams/${editTarget.team_id}/applications/${editTarget.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editName,
            description: editDescription,
            status: editStatus,
            visibility: editVisibility,
            redis_cache_size: editRedisCacheSize,
          }),
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "Update failed");
      setApps((prev) =>
        prev.map((a) =>
          a.id === editTarget.id
            ? {
                ...a,
                name: editName,
                description: editDescription,
                status: editStatus,
                visibility: editVisibility,
                redis_cache_size: editRedisCacheSize,
                sensor_types: editSensorTypes.map((s) => s.sensor_type),
              }
            : a,
        ),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteApp() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/orgs/${deleteTarget.organization_id}/teams/${deleteTarget.team_id}/applications/${deleteTarget.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setApps((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<AdminApp>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Application",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.slug}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "team_name",
        header: "Team",
        cell: ({ getValue }) => (
          <span className="text-sm">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "organization_name",
        header: "Organization",
        cell: ({ getValue }) => (
          <span className="text-sm">{(getValue() as string) || "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "";
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${STATUS_COLOUR[v] ?? ""}`}
            >
              {v || "—"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground line-clamp-1">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "sensor_types",
        header: () => (
          <div>
            <div>Sensor Types</div>
            <div className="flex gap-4 text-xs font-normal text-muted-foreground mt-0.5">
              <span>Sensor Type</span>
              <span>Sensor Value</span>
              <span>Last Value At</span>
            </div>
          </div>
        ),
        cell: ({ row }) => {
          const types = row.original.sensor_types;
          const cacheSize = row.original.redis_cache_size ?? 1;
          if (!types || types.length === 0)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="text-xs">
              <table className="w-full border-collapse">
                <tbody>
                  {types.flatMap((st) =>
                    Array.from({ length: cacheSize }, (_, i) => (
                      <tr
                        key={`${st}-slot-${i + 1}`}
                        className="border-b last:border-0"
                      >
                        {i === 0 && (
                          <td
                            rowSpan={cacheSize}
                            className="pr-3 py-0.5 font-mono align-top"
                          >
                            <Badge
                              variant="outline"
                              className="text-xs font-mono"
                            >
                              {st}
                            </Badge>
                          </td>
                        )}
                        <td className="pr-3 py-0.5 text-muted-foreground">—</td>
                        <td className="py-0.5 text-muted-foreground">—</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          );
        },
      },
      {
        id: "device_connection",
        header: "Devices",
        cell: ({ row }) => {
          const total = row.original.total_device_count ?? 0;
          const connected = row.original.connected_device_count ?? 0;
          if (total === 0)
            return <span className="text-xs text-muted-foreground">—</span>;
          const allOnline = connected === total;
          const someOnline = connected > 0 && connected < total;
          return (
            <Badge
              variant="outline"
              className={`text-xs ${
                allOnline
                  ? "border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
                  : someOnline
                    ? "border-yellow-400 text-yellow-700 dark:border-yellow-600 dark:text-yellow-400"
                    : "border-red-400 text-red-700 dark:border-red-600 dark:text-red-400"
              }`}
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                  allOnline
                    ? "bg-green-500 animate-pulse"
                    : someOnline
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-red-500"
                }`}
              />
              {connected}/{total} online
            </Badge>
          );
        },
      },
      {
        accessorKey: "visibility",
        header: "Visibility",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "team";
          const colours: Record<string, string> = {
            team: "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400",
            org: "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400",
            public:
              "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400",
          };
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${colours[v] ?? ""}`}
            >
              {v}
            </Badge>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const a = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditTarget(a);
                    setShowEdit(true);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    setDeleteTarget(a);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={14}
                    className="mr-2"
                  />{" "}
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={apps}
        filterKey="name"
        filterPlaceholder="Filter by name…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateAppName("");
                setCreateAppDescription("");
                setCreateAppTeamId("");
                setCreateAppError(null);
                setShowCreateApp(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              New Application
            </Button>
            <Badge variant="secondary" className="tabular-nums">
              {apps.length}
            </Badge>
          </div>
        }
      />

      <LiveMessagesPanel token={token} orgId={orgId} mode="application" />

      {/* Create App Sheet */}
      <Sheet open={showCreateApp} onOpenChange={setShowCreateApp}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Application</SheetTitle>
            <SheetDescription>
              Create a new application within a team.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Team *</Label>
              <Select
                value={createAppTeamId}
                onValueChange={setCreateAppTeamId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {teamsList.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                        {t.organization_name ? ` (${t.organization_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="My Application"
                value={createAppName}
                onChange={(e) => setCreateAppName(e.target.value)}
              />
              {createAppName && (
                <p className="text-xs text-muted-foreground">
                  Slug: {toSlug(createAppName)}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={createAppDescription}
                onChange={(e) => setCreateAppDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Visibility</Label>
              <Select
                value={createAppVisibility}
                onValueChange={(v) =>
                  setCreateAppVisibility(v as "team" | "org" | "public")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="team">Team (private to team)</SelectItem>
                    <SelectItem value="org">
                      Organization (all org members)
                    </SelectItem>
                    <SelectItem value="public">Public (all users)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Cache Size (last N values per sensor)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={createAppRedisCacheSize}
                onChange={(e) =>
                  setCreateAppRedisCacheSize(
                    Math.max(1, Number(e.target.value)),
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Number of last sensor values to retain per sensor type.
              </p>
            </div>
            {createAppError && (
              <p className="text-sm text-destructive">{createAppError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreateApp(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateApp}
              disabled={
                creatingApp || !createAppName.trim() || !createAppTeamId
              }
            >
              {creatingApp && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create Application
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Application</SheetTitle>
            <SheetDescription>{editTarget?.slug}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {["active", "inactive", "archived"].map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Visibility</Label>
              <Select
                value={editVisibility}
                onValueChange={(v) =>
                  setEditVisibility(v as "team" | "org" | "public")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="team">Team (private to team)</SelectItem>
                    <SelectItem value="org">
                      Organization (all org members)
                    </SelectItem>
                    <SelectItem value="public">Public (all users)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Cache Size (last N values per sensor)</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={editRedisCacheSize}
                onChange={(e) =>
                  setEditRedisCacheSize(Math.max(1, Number(e.target.value)))
                }
              />
              <p className="text-xs text-muted-foreground">
                Number of last sensor values to retain per sensor type.
              </p>
            </div>

            {/* Sensor Types */}
            <div className="grid gap-1.5">
              <Label>Sensor Types</Label>
              {editSensorTypes.length > 0 ? (
                <div className="flex flex-wrap gap-1 mb-1">
                  {editSensorTypes.map((st) => (
                    <div
                      key={st.sensor_type}
                      className="flex items-center gap-0.5"
                    >
                      <Badge
                        variant="secondary"
                        className="text-xs gap-1 rounded-r-none"
                      >
                        {st.sensor_type}
                      </Badge>
                      <Select
                        value={st.visibility}
                        onValueChange={(v) =>
                          handleUpdateSensorTypeVisibility(
                            st.sensor_type,
                            v as "team" | "org" | "public",
                          )
                        }
                      >
                        <SelectTrigger className="h-5 text-[10px] px-1.5 rounded-none border-l-0 w-auto gap-0.5 bg-muted">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="team">team</SelectItem>
                          <SelectItem value="org">org</SelectItem>
                          <SelectItem value="public">public</SelectItem>
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        className="h-5 px-1 text-xs rounded-l-none rounded-r-sm border border-l-0 border-input bg-muted hover:text-destructive"
                        onClick={() => handleRemoveSensorType(st.sensor_type)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No sensor types subscribed.
                </p>
              )}
              <div className="flex gap-2">
                {availableSensorTypes.length > 0 ? (
                  <Select
                    value={sensorTypeToAdd}
                    onValueChange={setSensorTypeToAdd}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select sensor type…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableSensorTypes
                          .filter(
                            (st) =>
                              !editSensorTypes.some(
                                (s) => s.sensor_type === st,
                              ),
                          )
                          .map((st) => (
                            <SelectItem key={st} value={st}>
                              {st}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="e.g. temperature"
                    value={sensorTypeToAdd}
                    onChange={(e) => setSensorTypeToAdd(e.target.value)}
                    className="flex-1"
                  />
                )}
                <Select
                  value={sensorTypeVisibility}
                  onValueChange={(v) =>
                    setSensorTypeVisibility(v as "team" | "org" | "public")
                  }
                >
                  <SelectTrigger className="w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">team</SelectItem>
                    <SelectItem value="org">org</SelectItem>
                    <SelectItem value="public">public</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddSensorType}
                  disabled={!sensorTypeToAdd.trim()}
                >
                  Add
                </Button>
              </div>
              {sensorTypeError && (
                <p className="text-xs text-destructive">{sensorTypeError}</p>
              )}
            </div>

            {/* Matched Devices */}
            <div className="grid gap-1.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                Matched Devices
                {loadingMatched && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={12}
                    className="animate-spin text-muted-foreground"
                  />
                )}
                {!loadingMatched && matchedDevices.length > 0 && (
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {new Set(matchedDevices.map((d) => d.device_id)).size}
                  </Badge>
                )}
              </Label>
              {!loadingMatched && matchedDevices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active devices in this team match the subscribed sensor
                  types.
                </p>
              )}
              {matchedDevices.length > 0 && (
                <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                  {Array.from(
                    matchedDevices
                      .reduce(
                        (map, d) => {
                          if (!map.has(d.device_id))
                            map.set(d.device_id, {
                              device_id: d.device_id,
                              device_key: d.device_key,
                              device_type: d.device_type,
                              vendor_name: d.vendor_name,
                              model_name: d.model_name,
                              sensor_types: [],
                              connection_status: d.connection_status,
                              last_heartbeat: d.last_heartbeat,
                            });
                          map
                            .get(d.device_id)
                            ?.sensor_types.push(
                              d.sensor_type +
                                (d.sensor_unit ? ` (${d.sensor_unit})` : ""),
                            );
                          return map;
                        },
                        new Map<
                          string,
                          {
                            device_id: string;
                            device_key: string;
                            device_type: string;
                            vendor_name: string;
                            model_name: string;
                            sensor_types: string[];
                            connection_status: string | null;
                            last_heartbeat: string | null;
                          }
                        >(),
                      )
                      .values(),
                  ).map((d) => (
                    <div key={d.device_id} className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs">
                          {d.device_key}
                        </span>
                        <div className="flex items-center gap-1">
                          {d.connection_status != null && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                d.connection_status === "connected"
                                  ? "border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
                                  : "border-red-400 text-red-700 dark:border-red-600 dark:text-red-400"
                              }`}
                            >
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                                  d.connection_status === "connected"
                                    ? "bg-green-500 animate-pulse"
                                    : "bg-red-500"
                                }`}
                              />
                              {d.connection_status === "connected"
                                ? "Online"
                                : "Offline"}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className="text-xs uppercase"
                          >
                            {d.device_type}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.vendor_name} — {d.model_name}
                        {d.last_heartbeat && (
                          <span className="ml-2 text-[10px]">
                            · seen{" "}
                            {(() => {
                              const diff =
                                Date.now() -
                                new Date(d.last_heartbeat).getTime();
                              const secs = Math.floor(diff / 1000);
                              return secs < 60
                                ? `${secs}s ago`
                                : secs < 3600
                                  ? `${Math.floor(secs / 60)}m ago`
                                  : `${Math.floor(secs / 3600)}h ago`;
                            })()}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.sensor_types.map((st) => (
                          <Badge
                            key={st}
                            variant="secondary"
                            className="text-xs font-mono"
                          >
                            {st}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveApp} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg border shadow-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="font-semibold text-base">Delete Application?</h2>
            <p className="text-sm text-muted-foreground">
              Permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleteTarget.name}
              </span>
              ? This cannot be undone.
            </p>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteApp}
                disabled={deleting}
              >
                {deleting && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="mr-2 animate-spin"
                  />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Tab: All Devices ──────────────────────────────────────────────────────────

function AllDevicesTab({
  token,
  isSuperAdmin,
  orgId,
}: {
  token: string;
  isSuperAdmin: boolean;
  orgId: number | null;
}) {
  const [devices, setDevices] = React.useState<AdminDevice[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Reference data for create form
  const [deviceModels, setDeviceModels] = React.useState<
    {
      id: number;
      name: string;
      code: string;
      vendor_name: string;
      device_type: string;
    }[]
  >([]);
  // Map of model_id -> sensor types (for column display)
  const [modelSensorsMap, setModelSensorsMap] = React.useState<
    Map<number, string[]>
  >(new Map());
  const [teamsList, setTeamsList] = React.useState<AdminTeam[]>([]);

  // Action state
  const [deleteTarget, setDeleteTarget] = React.useState<AdminDevice | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);
  const [toggling, setToggling] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Edit state
  const [editDeviceTarget, setEditDeviceTarget] =
    React.useState<AdminDevice | null>(null);
  const [showEditDevice, setShowEditDevice] = React.useState(false);
  const [editDeviceEui, setEditDeviceEui] = React.useState("");
  const [editDeviceMac, setEditDeviceMac] = React.useState("");
  const [editDeviceIsActive, setEditDeviceIsActive] = React.useState(true);
  const [editDeviceIsPublic, setEditDeviceIsPublic] = React.useState(false);
  const [editDeviceVisibility, setEditDeviceVisibility] = React.useState<
    "team" | "org" | "public"
  >("team");
  const [editDeviceIsPersistent, setEditDeviceIsPersistent] =
    React.useState(false);
  const [editDeviceIsGlobal, setEditDeviceIsGlobal] = React.useState(false);
  const [savingDevice, setSavingDevice] = React.useState(false);
  const [editDeviceError, setEditDeviceError] = React.useState<string | null>(
    null,
  );

  // Integration list for device assignment is no longer needed —
  // service_id is auto-set by the input adapter when a device connects.
  const [deviceIntegrations, setDeviceIntegrations] = React.useState<
    { id: number; name: string; type: string; direction: string }[]
  >([]);
  void deviceIntegrations; // retained for potential future use

  // Called by LiveMessagesPanel when a telemetry event arrives — updates
  // last_heartbeat + connection_status in the devices table in real-time.
  const handleTelemetryLastSeen = React.useCallback((event: TelemetryEvent) => {
    setDevices((prev) =>
      prev.map((d) =>
        String(event.device_key) === d.device_key
          ? {
              ...d,
              connection_status: "connected",
              last_heartbeat: new Date().toISOString(),
            }
          : d,
      ),
    );
  }, []);

  React.useEffect(() => {
    if (editDeviceTarget) {
      setEditDeviceEui(editDeviceTarget.eui ?? "");
      setEditDeviceMac(editDeviceTarget.mac_address ?? "");
      setEditDeviceIsActive(editDeviceTarget.is_active ?? true);
      setEditDeviceIsPublic(editDeviceTarget.is_public ?? false);
      setEditDeviceVisibility(
        (editDeviceTarget.visibility ?? "team") as "team" | "org" | "public",
      );
      setEditDeviceIsPersistent(editDeviceTarget.is_persistent ?? false);
      setEditDeviceIsGlobal(editDeviceTarget.is_global ?? false);
      setEditDeviceError(null);
    }
  }, [editDeviceTarget]);

  // Create state
  const [showCreateDevice, setShowCreateDevice] = React.useState(false);
  const [createDeviceModelId, setCreateDeviceModelId] = React.useState("");
  const [createDeviceEui, setCreateDeviceEui] = React.useState("");
  const [createDeviceMac, setCreateDeviceMac] = React.useState("");
  const [createDeviceOrgId, setCreateDeviceOrgId] = React.useState(
    orgId ? String(orgId) : "",
  );
  const [createDeviceTeamId, setCreateDeviceTeamId] = React.useState("");
  const [creatingDevice, setCreatingDevice] = React.useState(false);
  const [createDeviceError, setCreateDeviceError] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    const qs = !isSuperAdmin && orgId ? `?org_id=${orgId}` : "";
    fetch(`${API}/api/v1/devices${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        const parsed = z.array(deviceSchema).safeParse(json.data);
        if (parsed.success) setDevices(parsed.data);
        else {
          console.error("Devices parse error:", parsed.error.flatten());
          setError("Unexpected response shape — check console");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, isSuperAdmin, orgId]);

  // Load device models + sensor map
  React.useEffect(() => {
    fetch(`${API}/api/v1/device-models-with-sensors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) {
          const models = json.data as {
            id: number;
            name: string;
            code: string;
            vendor_name: string;
            device_type: string;
            sensor_types: { sensor_type: string }[];
          }[];
          setDeviceModels(
            models.map((m) => ({
              id: m.id,
              name: m.name,
              code: m.code,
              vendor_name: m.vendor_name,
              device_type: m.device_type ?? "other",
            })),
          );
          const map = new Map<number, string[]>();
          for (const m of models) {
            map.set(
              m.id,
              m.sensor_types.map((s) => s.sensor_type),
            );
          }
          setModelSensorsMap(map);
        }
      })
      .catch(() => {});
  }, [token]);

  // Load teams for create form
  React.useEffect(() => {
    if (!token) return;
    const url = isSuperAdmin
      ? `${API}/api/v1/teams`
      : orgId
        ? `${API}/api/v1/orgs/${orgId}/teams`
        : null;
    if (!url) return;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) {
          const parsed = z.array(teamSchema).safeParse(json.data);
          if (parsed.success) setTeamsList(parsed.data);
        }
      })
      .catch(() => {});
  }, [token, isSuperAdmin, orgId]);

  async function handleCreateDevice() {
    const modelId = Number(createDeviceModelId);
    const orgIdNum = Number(createDeviceOrgId);
    const teamIdNum = Number(createDeviceTeamId);
    if (!modelId || !orgIdNum || !teamIdNum) return;
    const model = deviceModels.find((m) => m.id === modelId);
    const deviceType = model?.device_type ?? "other";
    setCreatingDevice(true);
    setCreateDeviceError(null);
    try {
      const body: Record<string, unknown> = {
        device_model_id: modelId,
        device_type: deviceType,
        organization_id: orgIdNum,
        team_id: teamIdNum,
      };
      if (deviceType === "lorawan" && createDeviceEui)
        body.eui = createDeviceEui;
      if (deviceType === "ip" && createDeviceMac)
        body.mac_address = createDeviceMac;
      const r = await fetch(`${API}/api/v1/devices`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      setDevices((prev) => [
        {
          id: json.data.id,
          device_key: json.data.device_key,
          device_type: deviceType,
          eui: createDeviceEui || null,
          mac_address: createDeviceMac || null,
          vendor_name: model?.vendor_name ?? null,
          device_model_name: model?.name ?? null,
          device_model_code: model?.code ?? null,
          organization_id: orgIdNum,
          team_id: teamIdNum,
          is_active: true,
          is_public: false,
          is_global: false,
          visibility: "team" as const,
          connection_status: null,
          created_at: json.data.created_at,
        },
        ...prev,
      ]);
      setShowCreateDevice(false);
      setCreateDeviceModelId("");
      setCreateDeviceEui("");
      setCreateDeviceMac("");
      setCreateDeviceTeamId("");
      setShowCreateDevice(false);
    } catch (e: unknown) {
      setCreateDeviceError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingDevice(false);
    }
  }

  async function handleSaveDevice() {
    if (!editDeviceTarget) return;
    setSavingDevice(true);
    setEditDeviceError(null);
    const body: Record<string, unknown> = {
      is_active: editDeviceIsActive,
      is_public: editDeviceIsPublic,
      is_global: editDeviceIsGlobal,
      is_persistent: editDeviceIsPersistent,
      visibility: editDeviceVisibility,
    };
    if (
      editDeviceTarget.device_type === "lorawan" &&
      editDeviceEui !== undefined
    )
      body.eui = editDeviceEui;
    if (editDeviceTarget.device_type === "ip" && editDeviceMac !== undefined)
      body.mac_address = editDeviceMac;
    try {
      const r = await fetch(`${API}/api/v1/devices/${editDeviceTarget.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Update failed");
      setDevices((prev) =>
        prev.map((d) =>
          d.id === editDeviceTarget.id
            ? {
                ...d,
                eui:
                  editDeviceTarget.device_type === "lorawan"
                    ? editDeviceEui || null
                    : d.eui,
                mac_address:
                  editDeviceTarget.device_type === "ip"
                    ? editDeviceMac || null
                    : d.mac_address,
                is_active: editDeviceIsActive,
                is_public: editDeviceIsPublic,
                is_global: editDeviceIsGlobal,
                visibility: editDeviceVisibility,
              }
            : d,
        ),
      );
      setShowEditDevice(false);
      setEditDeviceTarget(null);
    } catch (e: unknown) {
      setEditDeviceError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDevice(false);
    }
  }

  const handleToggleActive = React.useCallback(
    async (device: AdminDevice) => {
      setToggling(device.id);
      setActionError(null);
      try {
        const r = await fetch(`${API}/api/v1/devices/${device.id}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ is_active: !device.is_active }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setDevices((prev) =>
          prev.map((d) =>
            d.id === device.id ? { ...d, is_active: !d.is_active } : d,
          ),
        );
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setToggling(null);
      }
    },
    [token],
  );

  async function handleDeleteDevice() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      const r = await fetch(`${API}/api/v1/devices/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDevices((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<AdminDevice>[] = React.useMemo(
    () => [
      {
        accessorKey: "device_key",
        header: "Device Key",
        cell: ({ row }) => (
          <div>
            <div className="font-mono text-xs">
              {row.original.device_key || "—"}
            </div>
            {row.original.eui && (
              <div className="text-xs text-muted-foreground">
                EUI: {row.original.eui}
              </div>
            )}
            {row.original.mac_address && (
              <div className="text-xs text-muted-foreground">
                MAC: {row.original.mac_address}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "device_type",
        header: "Type",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "";
          return (
            <Badge variant="outline" className="text-xs uppercase">
              {v || "—"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "vendor_name",
        header: "Vendor / Model",
        cell: ({ row }) => (
          <div>
            <div className="text-sm">{row.original.vendor_name || "—"}</div>
            {row.original.device_model_name && (
              <div className="text-xs text-muted-foreground">
                {row.original.device_model_name}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "organization_id",
        header: "Org / Team",
        cell: ({ row }) => (
          <div className="text-xs text-muted-foreground">
            <div>Org: {row.original.organization_id ?? "—"}</div>
            <div>Team: {row.original.team_id ?? "—"}</div>
          </div>
        ),
      },
      {
        accessorKey: "is_active",
        header: "Active",
        cell: ({ getValue }) =>
          getValue() ? (
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              size={14}
              className="text-green-600"
            />
          ) : (
            <span className="text-muted-foreground text-xs">inactive</span>
          ),
      },
      {
        accessorKey: "is_global",
        header: "Global",
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="outline" className="text-xs">
              global
            </Badge>
          ) : null,
      },
      {
        accessorKey: "visibility",
        header: "Visibility",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "team";
          const colours: Record<string, string> = {
            team: "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400",
            org: "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400",
            public:
              "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400",
          };
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${colours[v] ?? ""}`}
            >
              {v}
            </Badge>
          );
        },
      },
      {
        id: "sensor_types",
        header: "Sensor Types",
        cell: ({ row }) => {
          const dm = deviceModels.find(
            (m) => m.code === row.original.device_model_code,
          );
          const sensorTypes = dm ? (modelSensorsMap.get(dm.id) ?? []) : [];
          if (!sensorTypes.length)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {sensorTypes.map((st) => (
                <Badge key={st} variant="outline" className="text-xs font-mono">
                  {st}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        accessorKey: "connection_status",
        header: "Connection",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "disconnected";
          const online = v === "connected";
          return (
            <Badge
              variant="outline"
              className={`text-xs ${
                online
                  ? "border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
                  : "border-red-400 text-red-700 dark:border-red-600 dark:text-red-400"
              }`}
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                  online ? "bg-green-500 animate-pulse" : "bg-red-500"
                }`}
              />
              {online ? "Online" : "Offline"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "last_heartbeat",
        header: "Last Seen",
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          if (!v)
            return <span className="text-xs text-muted-foreground">Never</span>;
          const diff = Date.now() - new Date(v).getTime();
          const secs = Math.floor(diff / 1000);
          const label =
            secs < 60
              ? `${secs}s ago`
              : secs < 3600
                ? `${Math.floor(secs / 60)}m ago`
                : secs < 86400
                  ? `${Math.floor(secs / 3600)}h ago`
                  : `${Math.floor(secs / 86400)}d ago`;
          return (
            <span className="text-xs text-muted-foreground tabular-nums">
              {label}
            </span>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const d = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditDeviceTarget(d);
                    setShowEditDevice(true);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleToggleActive(d)}
                  disabled={toggling === d.id}
                >
                  {toggling === d.id ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={14}
                      className="mr-2 animate-spin"
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={CheckmarkCircle01Icon}
                      size={14}
                      className="mr-2"
                    />
                  )}
                  {d.is_active ? "Deactivate" : "Activate"}
                </DropdownMenuItem>
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      setDeleteTarget(d);
                      setActionError(null);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={14}
                      className="mr-2"
                    />{" "}
                    Delete
                  </DropdownMenuItem>
                </>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [toggling, handleToggleActive, modelSensorsMap, deviceModels],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={devices}
        filterKey="device_key"
        filterPlaceholder="Filter by device key…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateDeviceModelId("");
                setCreateDeviceEui("");
                setCreateDeviceMac("");
                setCreateDeviceOrgId(orgId ? String(orgId) : "");
                setCreateDeviceTeamId("");
                setCreateDeviceError(null);
                setShowCreateDevice(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              New Device
            </Button>
            <Badge variant="secondary" className="tabular-nums">
              {devices.length}
            </Badge>
          </div>
        }
      />
      {actionError && !deleteTarget && (
        <p className="text-sm text-destructive mt-2">{actionError}</p>
      )}

      <LiveMessagesPanel
        token={token}
        orgId={orgId}
        mode="device"
        onTelemetryEvent={handleTelemetryLastSeen}
      />

      {/* Edit Device Sheet */}
      <Sheet
        open={showEditDevice}
        onOpenChange={(o) => {
          setShowEditDevice(o);
          if (!o) setEditDeviceTarget(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Device</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {editDeviceTarget?.device_key ?? editDeviceTarget?.id}
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            {/* Read-only info */}
            <div className="grid gap-1.5 text-sm text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Type:</span>{" "}
                <Badge variant="outline" className="text-xs uppercase">
                  {editDeviceTarget?.device_type ?? "—"}
                </Badge>
              </div>
              <div>
                <span className="font-medium text-foreground">Model:</span>{" "}
                {editDeviceTarget?.vendor_name} —{" "}
                {editDeviceTarget?.device_model_name ?? "—"}
              </div>
            </div>

            {/* EUI (LoRaWAN) */}
            {editDeviceTarget?.device_type === "lorawan" && (
              <div className="grid gap-1.5">
                <Label>Dev EUI</Label>
                <Input
                  placeholder="16 hex characters"
                  value={editDeviceEui}
                  onChange={(e) => setEditDeviceEui(e.target.value)}
                  maxLength={16}
                  className="font-mono"
                />
              </div>
            )}

            {/* MAC Address (IP) */}
            {editDeviceTarget?.device_type === "ip" && (
              <div className="grid gap-1.5">
                <Label>MAC Address</Label>
                <Input
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={editDeviceMac}
                  onChange={(e) => setEditDeviceMac(e.target.value)}
                  className="font-mono"
                />
              </div>
            )}

            {/* Boolean flags */}
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <input
                  type="checkbox"
                  checked={editDeviceIsActive}
                  onChange={(e) => setEditDeviceIsActive(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Public</Label>
                <input
                  type="checkbox"
                  checked={editDeviceIsPublic}
                  onChange={(e) => setEditDeviceIsPublic(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Persistent</Label>
                <input
                  type="checkbox"
                  checked={editDeviceIsPersistent}
                  onChange={(e) => setEditDeviceIsPersistent(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Global</Label>
                <input
                  type="checkbox"
                  checked={editDeviceIsGlobal}
                  onChange={(e) => setEditDeviceIsGlobal(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Visibility</Label>
              <Select
                value={editDeviceVisibility}
                onValueChange={(v) =>
                  setEditDeviceVisibility(v as "team" | "org" | "public")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="team">Team (private to team)</SelectItem>
                    <SelectItem value="org">
                      Organization (all org members)
                    </SelectItem>
                    <SelectItem value="public">Public (all users)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {editDeviceError && (
              <p className="text-sm text-destructive">{editDeviceError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEditDevice(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDevice} disabled={savingDevice}>
              {savingDevice && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Create Device Sheet */}
      <Sheet open={showCreateDevice} onOpenChange={setShowCreateDevice}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Device</SheetTitle>
            <SheetDescription>Register a new device.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Device Model *</Label>
              <Select
                value={createDeviceModelId}
                onValueChange={setCreateDeviceModelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select model…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {deviceModels.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.vendor_name} — {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {createDeviceModelId &&
              (() => {
                const m = deviceModels.find(
                  (m) => m.id === Number(createDeviceModelId),
                );
                const dt = m?.device_type ?? "other";
                return (
                  <>
                    <div className="grid gap-1.5">
                      <Label>Device Type</Label>
                      <div className="flex items-center gap-2 py-1">
                        <Badge
                          variant={
                            dt === "lorawan"
                              ? "default"
                              : dt === "ip"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-xs"
                        >
                          {dt === "lorawan"
                            ? "LoRaWAN"
                            : dt === "ip"
                              ? "IP / MQTT"
                              : "Other"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          From model registry
                        </span>
                      </div>
                    </div>
                    {dt === "lorawan" && (
                      <div className="grid gap-1.5">
                        <Label>Dev EUI *</Label>
                        <Input
                          placeholder="16 hex characters"
                          value={createDeviceEui}
                          onChange={(e) => setCreateDeviceEui(e.target.value)}
                          maxLength={16}
                        />
                      </div>
                    )}
                    {dt === "ip" && (
                      <div className="grid gap-1.5">
                        <Label>MAC Address *</Label>
                        <Input
                          placeholder="AA:BB:CC:DD:EE:FF"
                          value={createDeviceMac}
                          onChange={(e) => setCreateDeviceMac(e.target.value)}
                        />
                      </div>
                    )}
                  </>
                );
              })()}
            <div className="grid gap-1.5">
              <Label>Team *</Label>
              <Select
                value={createDeviceTeamId}
                onValueChange={(v) => {
                  setCreateDeviceTeamId(v);
                  const t = teamsList.find((t) => t.id === Number(v));
                  if (t?.organization_id)
                    setCreateDeviceOrgId(String(t.organization_id));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {teamsList.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                        {t.organization_name ? ` (${t.organization_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {createDeviceError && (
              <p className="text-sm text-destructive">{createDeviceError}</p>
            )}
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDevice(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateDevice}
              disabled={
                creatingDevice ||
                !createDeviceModelId ||
                !createDeviceTeamId ||
                !createDeviceOrgId
              }
            >
              {creatingDevice && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create Device
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg border shadow-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="font-semibold text-base">Delete Device?</h2>
            <p className="text-sm text-muted-foreground">
              Permanently delete device{" "}
              <span className="font-medium font-mono text-foreground">
                {deleteTarget.device_key || deleteTarget.id}
              </span>
              ? This cannot be undone.
            </p>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteDevice}
                disabled={deleting}
              >
                {deleting && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="mr-2 animate-spin"
                  />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Tab: Device Models ────────────────────────────────────────────────────────

type DeviceModelWithSensors = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  device_type: string;
  vendor_name: string;
  vendor_id: number;
  sensor_types: {
    id: number;
    sensor_type: string;
    unit: string | null;
    description: string | null;
    value_type: string;
  }[];
};

type AdminVendor = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function AllDeviceModelsTab({
  token,
  isSuperAdmin,
}: {
  token: string;
  isSuperAdmin: boolean;
}) {
  const [models, setModels] = React.useState<DeviceModelWithSensors[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Edit state — for managing sensor types on a model
  const [editModel, setEditModel] =
    React.useState<DeviceModelWithSensors | null>(null);
  const [showEditSheet, setShowEditSheet] = React.useState(false);
  const [newSensorType, setNewSensorType] = React.useState("");
  const [newSensorUnit, setNewSensorUnit] = React.useState("");
  const [newSensorDesc, setNewSensorDesc] = React.useState("");
  const [newSensorValueType, setNewSensorValueType] = React.useState("float");
  const [sensorOpError, setSensorOpError] = React.useState<string | null>(null);
  const [addingSensor, setAddingSensor] = React.useState(false);
  const [deletingSensor, setDeletingSensor] = React.useState<number | null>(
    null,
  );

  // Vendors list for create/edit model dropdowns
  const [vendors, setVendors] = React.useState<AdminVendor[]>([]);

  // Create model state
  const [showCreateModel, setShowCreateModel] = React.useState(false);
  const [createModelName, setCreateModelName] = React.useState("");
  const [createModelCode, setCreateModelCode] = React.useState("");
  const [createModelVendorId, setCreateModelVendorId] = React.useState("");
  const [createModelDesc, setCreateModelDesc] = React.useState("");
  const [createModelDeviceType, setCreateModelDeviceType] =
    React.useState("other");
  const [creatingModel, setCreatingModel] = React.useState(false);
  const [createModelError, setCreateModelError] = React.useState<string | null>(
    null,
  );

  // Edit model state
  const [editModelTarget, setEditModelTarget] =
    React.useState<DeviceModelWithSensors | null>(null);
  const [showEditModel, setShowEditModel] = React.useState(false);
  const [editModelName, setEditModelName] = React.useState("");
  const [editModelCode, setEditModelCode] = React.useState("");
  const [editModelVendorId, setEditModelVendorId] = React.useState("");
  const [editModelDesc, setEditModelDesc] = React.useState("");
  const [editModelDeviceType, setEditModelDeviceType] = React.useState("other");
  const [savingModel, setSavingModel] = React.useState(false);
  const [editModelError, setEditModelError] = React.useState<string | null>(
    null,
  );

  // Delete model state
  const [deleteModelTarget, setDeleteModelTarget] =
    React.useState<DeviceModelWithSensors | null>(null);
  const [deletingModel, setDeletingModel] = React.useState(false);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    fetch(`${API}/api/v1/device-models-with-sensors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        setModels(json.data as DeviceModelWithSensors[]);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [token]);

  // Load vendors for dropdowns
  React.useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/device-vendors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) setVendors(json.data as AdminVendor[]);
      })
      .catch(() => {});
  }, [token]);

  async function handleAddSensor() {
    if (!editModel || !newSensorType.trim()) return;
    setAddingSensor(true);
    setSensorOpError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/device-models/${editModel.id}/sensors`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sensor_type: newSensorType.trim().toLowerCase(),
            unit: newSensorUnit.trim() || undefined,
            description: newSensorDesc.trim() || undefined,
            value_type: newSensorValueType,
          }),
        },
      );
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Failed to add sensor");
      const added = {
        id: json.data.id as number,
        sensor_type: json.data.sensorType as string,
        unit: json.data.unit as string | null,
        description: json.data.description as string | null,
        value_type: json.data.valueType as string,
      };
      setEditModel((prev) =>
        prev
          ? {
              ...prev,
              sensor_types: [...prev.sensor_types, added].sort((a, b) =>
                a.sensor_type.localeCompare(b.sensor_type),
              ),
            }
          : prev,
      );
      setModels((prev) =>
        prev.map((m) =>
          m.id === editModel.id
            ? {
                ...m,
                sensor_types: [...m.sensor_types, added].sort((a, b) =>
                  a.sensor_type.localeCompare(b.sensor_type),
                ),
              }
            : m,
        ),
      );
      setNewSensorType("");
      setNewSensorUnit("");
      setNewSensorDesc("");
      setNewSensorValueType("float");
    } catch (e: unknown) {
      setSensorOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingSensor(false);
    }
  }

  async function handleDeleteSensor(sensorId: number, sensorType: string) {
    if (!editModel) return;
    setDeletingSensor(sensorId);
    setSensorOpError(null);
    try {
      const r = await fetch(
        `${API}/api/v1/device-models/${editModel.id}/sensors/${sensorId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setEditModel((prev) =>
        prev
          ? {
              ...prev,
              sensor_types: prev.sensor_types.filter(
                (s) => s.sensor_type !== sensorType,
              ),
            }
          : prev,
      );
      setModels((prev) =>
        prev.map((m) =>
          m.id === editModel.id
            ? {
                ...m,
                sensor_types: m.sensor_types.filter(
                  (s) => s.sensor_type !== sensorType,
                ),
              }
            : m,
        ),
      );
    } catch (e: unknown) {
      setSensorOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingSensor(null);
    }
  }

  async function handleCreateModel() {
    if (
      !createModelName.trim() ||
      !createModelCode.trim() ||
      !createModelVendorId
    )
      return;
    setCreatingModel(true);
    setCreateModelError(null);
    try {
      const r = await fetch(`${API}/api/v1/device-models`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vendor_id: Number(createModelVendorId),
          name: createModelName.trim(),
          code: createModelCode.trim().toLowerCase(),
          description: createModelDesc.trim() || undefined,
          device_type: createModelDeviceType,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      const vendor = vendors.find((v) => v.id === Number(createModelVendorId));
      setModels((prev) => [
        ...prev,
        {
          id: json.data.id,
          name: json.data.name,
          code: json.data.code,
          description: json.data.description ?? null,
          device_type: createModelDeviceType,
          vendor_name: vendor?.name ?? "",
          vendor_id: Number(createModelVendorId),
          sensor_types: [],
        },
      ]);
      setShowCreateModel(false);
      setCreateModelName("");
      setCreateModelCode("");
      setCreateModelVendorId("");
      setCreateModelDesc("");
      setCreateModelDeviceType("other");
    } catch (e: unknown) {
      setCreateModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingModel(false);
    }
  }

  async function handleSaveModel() {
    if (!editModelTarget) return;
    setSavingModel(true);
    setEditModelError(null);
    try {
      const body: Record<string, unknown> = {};
      if (editModelName.trim()) body.name = editModelName.trim();
      if (editModelCode.trim()) body.code = editModelCode.trim().toLowerCase();
      if (editModelVendorId) body.vendor_id = Number(editModelVendorId);
      body.description = editModelDesc.trim() || null;
      body.device_type = editModelDeviceType;
      const r = await fetch(
        `${API}/api/v1/device-models/${editModelTarget.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Update failed");
      const vendor = vendors.find(
        (v) => v.id === Number(editModelVendorId || editModelTarget.vendor_id),
      );
      setModels((prev) =>
        prev.map((m) =>
          m.id === editModelTarget.id
            ? {
                ...m,
                name: editModelName.trim() || m.name,
                code: editModelCode.trim()
                  ? editModelCode.trim().toLowerCase()
                  : m.code,
                description: editModelDesc.trim() || null,
                device_type: editModelDeviceType,
                vendor_id: editModelVendorId
                  ? Number(editModelVendorId)
                  : m.vendor_id,
                vendor_name: vendor?.name ?? m.vendor_name,
              }
            : m,
        ),
      );
      setShowEditModel(false);
      setEditModelTarget(null);
    } catch (e: unknown) {
      setEditModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingModel(false);
    }
  }

  async function handleDeleteModel() {
    if (!deleteModelTarget) return;
    setDeletingModel(true);
    try {
      const r = await fetch(
        `${API}/api/v1/device-models/${deleteModelTarget.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setModels((prev) => prev.filter((m) => m.id !== deleteModelTarget.id));
      setDeleteModelTarget(null);
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setDeletingModel(false);
    }
  }

  const columns: ColumnDef<DeviceModelWithSensors>[] = React.useMemo(
    () => [
      {
        accessorKey: "vendor_name",
        header: "Vendor",
        cell: ({ getValue }) => (
          <span className="font-medium text-sm">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "name",
        header: "Model",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.name}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {row.original.code}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground line-clamp-1">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "device_type",
        header: "Device Type",
        cell: ({ getValue }) => {
          const dt = (getValue() as string) ?? "other";
          return (
            <Badge
              variant={
                dt === "lorawan"
                  ? "default"
                  : dt === "ip"
                    ? "secondary"
                    : "outline"
              }
              className="text-xs"
            >
              {dt === "lorawan"
                ? "LoRaWAN"
                : dt === "ip"
                  ? "IP / MQTT"
                  : "Other"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "sensor_types",
        header: "Sensor Types",
        cell: ({ getValue }) => {
          const sensors = getValue() as DeviceModelWithSensors["sensor_types"];
          if (!sensors.length)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {sensors.map((s) => (
                <Badge
                  key={s.sensor_type}
                  variant="outline"
                  className="text-xs font-mono"
                >
                  {s.sensor_type}
                  {s.unit && (
                    <span className="ml-1 text-muted-foreground">
                      ({s.unit})
                    </span>
                  )}
                  <span className="ml-1 text-muted-foreground opacity-60">
                    [{s.value_type}]
                  </span>
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditModel(m);
                    setNewSensorType("");
                    setNewSensorUnit("");
                    setNewSensorDesc("");
                    setNewSensorValueType("float");
                    setSensorOpError(null);
                    setShowEditSheet(true);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />
                  Edit Sensors
                </DropdownMenuItem>
                {isSuperAdmin && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        setEditModelTarget(m);
                        setEditModelName(m.name);
                        setEditModelCode(m.code);
                        setEditModelVendorId(String(m.vendor_id));
                        setEditModelDesc(m.description ?? "");
                        setEditModelDeviceType(m.device_type ?? "other");
                        setEditModelError(null);
                        setShowEditModel(true);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Edit01Icon}
                        size={14}
                        className="mr-2"
                      />
                      Edit Model
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteModelTarget(m)}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        size={14}
                        className="mr-2"
                      />
                      Delete Model
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [isSuperAdmin],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={models}
        filterKey="name"
        filterPlaceholder="Filter by model name…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <Button
                size="sm"
                onClick={() => {
                  setCreateModelName("");
                  setCreateModelCode("");
                  setCreateModelVendorId("");
                  setCreateModelDesc("");
                  setCreateModelError(null);
                  setShowCreateModel(true);
                }}
              >
                <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
                New Model
              </Button>
            )}
            <Badge variant="secondary" className="tabular-nums">
              {models.length}
            </Badge>
          </div>
        }
      />

      {/* Edit Sensors Sheet */}
      <Sheet
        open={showEditSheet}
        onOpenChange={(o) => {
          setShowEditSheet(o);
          if (!o) setEditModel(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Sensor Types</SheetTitle>
            <SheetDescription>
              {editModel?.vendor_name} — {editModel?.name}{" "}
              <span className="font-mono text-xs">({editModel?.code})</span>
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            {/* Current sensors */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">
                Registered Sensor Types
              </Label>
              {editModel?.sensor_types.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No sensor types registered.
                </p>
              ) : (
                <div className="rounded-md border divide-y">
                  {editModel?.sensor_types.map((s) => (
                    <div
                      key={s.sensor_type}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <span className="font-mono text-sm font-medium">
                          {s.sensor_type}
                        </span>
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {s.value_type}
                        </Badge>
                        {s.unit && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {s.unit}
                          </span>
                        )}
                        {s.description && (
                          <div className="text-xs text-muted-foreground">
                            {s.description}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        disabled={deletingSensor === s.id}
                        onClick={() => handleDeleteSensor(s.id, s.sensor_type)}
                      >
                        {deletingSensor === s.id ? (
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            size={12}
                            className="animate-spin"
                          />
                        ) : (
                          <HugeiconsIcon icon={Delete02Icon} size={12} />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add new sensor */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Add Sensor Type</Label>
              <div className="grid gap-2">
                <Input
                  placeholder="sensor_type (e.g. a_plus)"
                  value={newSensorType}
                  onChange={(e) =>
                    setNewSensorType(e.target.value.toLowerCase())
                  }
                  className="font-mono"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Unit (e.g. kWh)"
                    value={newSensorUnit}
                    onChange={(e) => setNewSensorUnit(e.target.value)}
                  />
                  <Input
                    placeholder="Description"
                    value={newSensorDesc}
                    onChange={(e) => setNewSensorDesc(e.target.value)}
                  />
                </div>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                  value={newSensorValueType}
                  onChange={(e) => setNewSensorValueType(e.target.value)}
                >
                  <option value="float">float</option>
                  <option value="int">int</option>
                  <option value="bool">bool</option>
                  <option value="string">string</option>
                </select>
                <Button
                  size="sm"
                  onClick={handleAddSensor}
                  disabled={addingSensor || !newSensorType.trim()}
                >
                  {addingSensor ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={14}
                      className="mr-2 animate-spin"
                    />
                  ) : (
                    <HugeiconsIcon
                      icon={Add01Icon}
                      size={14}
                      className="mr-1"
                    />
                  )}
                  Add
                </Button>
              </div>
              {sensorOpError && (
                <p className="text-xs text-destructive">{sensorOpError}</p>
              )}
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEditSheet(false)}>
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Create Model Sheet */}
      <Sheet open={showCreateModel} onOpenChange={setShowCreateModel}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Device Model</SheetTitle>
            <SheetDescription>
              Add a new model to the platform.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Vendor *</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={createModelVendorId}
                onChange={(e) => setCreateModelVendorId(e.target.value)}
              >
                <option value="">Select vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Model Name *</Label>
              <Input
                value={createModelName}
                onChange={(e) => setCreateModelName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Model Code *</Label>
              <Input
                className="font-mono"
                placeholder="e.g. em340"
                value={createModelCode}
                onChange={(e) =>
                  setCreateModelCode(e.target.value.toLowerCase())
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={createModelDesc}
                onChange={(e) => setCreateModelDesc(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Device Type *</Label>
              <Select
                value={createModelDeviceType}
                onValueChange={setCreateModelDeviceType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lorawan">LoRaWAN</SelectItem>
                  <SelectItem value="ip">IP / MQTT</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createModelError && (
              <p className="text-sm text-destructive">{createModelError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreateModel(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateModel}
              disabled={
                creatingModel ||
                !createModelName.trim() ||
                !createModelCode.trim() ||
                !createModelVendorId
              }
            >
              {creatingModel && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Model Sheet */}
      <Sheet
        open={showEditModel}
        onOpenChange={(o) => {
          setShowEditModel(o);
          if (!o) setEditModelTarget(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Device Model</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {editModelTarget?.code}
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Vendor</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={editModelVendorId}
                onChange={(e) => setEditModelVendorId(e.target.value)}
              >
                {vendors.map((v) => (
                  <option key={v.id} value={String(v.id)}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Model Name</Label>
              <Input
                value={editModelName}
                onChange={(e) => setEditModelName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Model Code</Label>
              <Input
                className="font-mono"
                value={editModelCode}
                onChange={(e) => setEditModelCode(e.target.value.toLowerCase())}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={editModelDesc}
                onChange={(e) => setEditModelDesc(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Device Type</Label>
              <Select
                value={editModelDeviceType}
                onValueChange={setEditModelDeviceType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lorawan">LoRaWAN</SelectItem>
                  <SelectItem value="ip">IP / MQTT</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editModelError && (
              <p className="text-sm text-destructive">{editModelError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEditModel(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveModel} disabled={savingModel}>
              {savingModel && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Model Dialog */}
      <AlertDialog
        open={!!deleteModelTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteModelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Device Model</AlertDialogTitle>
            <AlertDialogDescription>
              Delete{" "}
              <span className="font-semibold">{deleteModelTarget?.name}</span>?
              This will also delete all associated sensor definitions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteModel}
              disabled={deletingModel}
            >
              {deletingModel && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Tab: All Vendors (superAdmin only) ──────────────────────────────────────

function AllVendorsTab({ token }: { token: string }) {
  const [vendors, setVendors] = React.useState<AdminVendor[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Create state
  const [showCreate, setShowCreate] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createCode, setCreateCode] = React.useState("");
  const [createDesc, setCreateDesc] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Edit state
  const [editTarget, setEditTarget] = React.useState<AdminVendor | null>(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editCode, setEditCode] = React.useState("");
  const [editDesc, setEditDesc] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = React.useState<AdminVendor | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (editTarget) {
      setEditName(editTarget.name);
      setEditCode(editTarget.code);
      setEditDesc(editTarget.description ?? "");
    }
  }, [editTarget]);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    fetch(`${API}/api/v1/device-vendors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        setVendors(json.data as AdminVendor[]);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleCreate() {
    if (!createName.trim() || !createCode.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch(`${API}/api/v1/device-vendors`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: createName.trim(),
          code: createCode.trim().toLowerCase(),
          description: createDesc.trim() || undefined,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      setVendors((prev) => [
        ...prev,
        {
          id: json.data.id,
          name: json.data.name,
          code: json.data.code,
          description: json.data.description ?? null,
          created_at: json.data.createdAt ?? null,
          updated_at: json.data.updatedAt ?? null,
        },
      ]);
      setShowCreate(false);
      setCreateName("");
      setCreateCode("");
      setCreateDesc("");
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    if (!editTarget) return;
    setSaving(true);
    setEditError(null);
    try {
      const r = await fetch(`${API}/api/v1/device-vendors/${editTarget.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          code: editCode.trim() ? editCode.trim().toLowerCase() : undefined,
          description: editDesc.trim() || null,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Update failed");
      setVendors((prev) =>
        prev.map((v) =>
          v.id === editTarget.id
            ? {
                ...v,
                name: editName.trim() || v.name,
                code: editCode.trim() ? editCode.trim().toLowerCase() : v.code,
                description: editDesc.trim() || null,
              }
            : v,
        ),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`${API}/api/v1/device-vendors/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setVendors((prev) => prev.filter((v) => v.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<AdminVendor>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ getValue }) => (
          <span className="font-medium text-sm">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground line-clamp-1">
            {(getValue() as string) || "—"}
          </span>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const v = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditTarget(v);
                    setEditError(null);
                    setShowEdit(true);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteTarget(v)}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={14}
                    className="mr-2"
                  />{" "}
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={vendors}
        filterKey="name"
        filterPlaceholder="Filter by vendor name…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateName("");
                setCreateCode("");
                setCreateDesc("");
                setCreateError(null);
                setShowCreate(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              New Vendor
            </Button>
            <Badge variant="secondary" className="tabular-nums">
              {vendors.length}
            </Badge>
          </div>
        }
      />

      {/* Create Sheet */}
      <Sheet open={showCreate} onOpenChange={setShowCreate}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Device Vendor</SheetTitle>
            <SheetDescription>
              Add a new device vendor to the platform.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input
                className="font-mono"
                placeholder="e.g. carlo-gavazzi"
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value.toLowerCase())}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
              />
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !createName.trim() || !createCode.trim()}
            >
              {creating && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Vendor</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {editTarget?.code}
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Code</Label>
              <Input
                className="font-mono"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value.toLowerCase())}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
            </div>
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vendor</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <span className="font-semibold">{deleteTarget?.name}</span>
              ? This will fail if any models are still linked to this vendor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
// ─── Tab: All Integrations ────────────────────────────────────────────────────

type AdminIntegration = {
  id: number;
  name: string;
  description: string | null;
  service_type: string;
  type: string;
  direction: string;
  organization_id: number | null;
  team_id: number | null;
  provider: { id: number; code: string; display_name: string } | null;
  is_global: boolean | null;
  is_active: boolean | null;
  config: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type IntegrationStatus = {
  service_id: number;
  service_type: string;
  is_connected: boolean;
  message_count: number;
  error_count: number;
  broker?: string;
  topics?: string[];
  last_message_at: string;
  reported_at: string;
};

type IntegrationProvider = { id: number; code: string; display_name: string };

const INTEGRATION_TYPE_LABELS: Record<string, string> = {
  "input.mqtt": "MQTT Subscriber",
  "input.grpc-server": "gRPC Server",
  "input.grpc-pull": "gRPC Pull",
  "input.http-server": "HTTP Server",
  "input.http-pull": "HTTP Pull",
  "output.mqtt": "MQTT Publisher",
  "output.grpc-push": "gRPC Push",
  "output.http-push": "HTTP Push",
  "output.influxdb3": "InfluxDB3",
  "output.clickhouse": "ClickHouse",
};

const INTEGRATION_DIRECTION_COLOURS: Record<string, string> = {
  input:
    "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400",
  output:
    "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400",
};

const INTEGRATION_TYPES_INPUT = [
  "input.mqtt",
  "input.grpc-server",
  "input.grpc-pull",
  "input.http-server",
  "input.http-pull",
] as const;
const ALL_INTEGRATION_TYPES = [
  "input.mqtt",
  "input.grpc-server",
  "input.grpc-pull",
  "input.http-server",
  "input.http-pull",
  "output.mqtt",
  "output.grpc-push",
  "output.http-push",
  "output.influxdb3",
  "output.clickhouse",
] as const;

function directionForType(type: string): "input" | "output" {
  return type.startsWith("input.") ? "input" : "output";
}

/** Returns a short human-readable config summary based on service_type */
function configSummary(type: string, cfg: Record<string, unknown> | null) {
  if (!cfg) return "—";
  switch (type) {
    case "input.mqtt":
    case "output.mqtt":
      return `${cfg.host ?? "?"}:${cfg.port ?? "?"}`;
    case "input.grpc-server":
    case "input.grpc-pull":
    case "output.grpc-push":
      return `${cfg.host ?? "0.0.0.0"}:${cfg.port ?? "?"}`;
    case "input.http-server":
      return String(cfg.listen_path ?? "/ingest");
    case "input.http-pull":
    case "output.http-push":
      return String(cfg.base_url ?? "?");
    case "output.influxdb3":
      return `${cfg.host ?? "?"}:${cfg.port ?? 8086} / ${cfg.bucket ?? "?"}`;
    case "output.clickhouse":
      return `${cfg.host ?? "?"}:${cfg.port ?? 9000} / ${cfg.database ?? "default"}`;
    default:
      return "—";
  }
}

// ─── Service Logs Panel ───────────────────────────────────────────────────────

type SvcLogEntry = {
  id: number;
  ts: string;
  kind: "heartbeat" | "raw_ingest" | "output_ack";
  data: HeartbeatEvent | RawIngestEvent | OutputAckEvent;
};

function ServiceLogsPanel({
  open,
  onClose,
  integration,
  token,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  integration: AdminIntegration | null;
  token: string;
  orgId: number | null;
}) {
  const [connected, setConnected] = React.useState(false);
  const [logs, setLogs] = React.useState<SvcLogEntry[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const logIdRef = React.useRef(0);
  const cleanupRef = React.useRef<(() => void) | null>(null);

  // Auto-scroll on new logs
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Subscribe / unsubscribe when panel opens or changes target
  React.useEffect(() => {
    if (!open || !integration) return;
    setLogs([]);
    setConnected(false);

    const effectiveOrgId = integration.organization_id ?? orgId;

    function addLog(kind: SvcLogEntry["kind"], data: SvcLogEntry["data"]) {
      setLogs((prev) => {
        const entry: SvcLogEntry = {
          id: ++logIdRef.current,
          ts: new Date().toISOString(),
          kind,
          data,
        };
        const next = [...prev, entry];
        return next.length > 300 ? next.slice(-300) : next;
      });
    }

    subscribeNatsRealtime({
      wsUrl: NATS_WS_URL,
      token,
      orgId: effectiveOrgId,
      mode: "integration",
      serviceId: integration.id,
      onConnected: () => setConnected(true),
      onDisconnected: () => setConnected(false),
      onHeartbeat: (e) => addLog("heartbeat", e),
      onRawIngest: (e) => addLog("raw_ingest", e),
      onOutputAck: (e) => addLog("output_ack", e),
      onMessage: () => {},
    }).then((fn) => {
      cleanupRef.current = fn;
    });

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [open, integration?.id, integration?.organization_id, orgId, token]);

  if (!integration) return null;

  const dir = directionForType(integration.type);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
        <SheetHeader className="flex-none">
          <div className="flex items-center gap-2">
            <SheetTitle className="leading-tight">
              {INTEGRATION_TYPE_LABELS[integration.type] ?? integration.type}
            </SheetTitle>
            <Badge
              variant="outline"
              className={`text-[10px] ${INTEGRATION_DIRECTION_COLOURS[dir] ?? ""}`}
            >
              {dir}
            </Badge>
            <div className="flex items-center gap-1 ml-auto text-xs">
              <span
                className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground/40"}`}
              />
              <span className="text-muted-foreground">
                {connected ? "connected" : "connecting…"}
              </span>
            </div>
          </div>
          <SheetDescription className="text-xs">
            {integration.name} · service_id={integration.id}
          </SheetDescription>
        </SheetHeader>

        {/* Log legend */}
        <div className="flex-none flex gap-3 text-[10px] text-muted-foreground py-1 border-b">
          <span className="flex items-center gap-1">
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 border-purple-400 text-purple-600"
            >
              HB
            </Badge>
            heartbeat
          </span>
          <span className="flex items-center gap-1">
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 border-amber-400 text-amber-600"
            >
              RX
            </Badge>
            raw ingest
          </span>
          <span className="flex items-center gap-1">
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 border-green-400 text-green-600"
            >
              TX
            </Badge>
            output ack
          </span>
          <span className="ml-auto">{logs.length} events (max 300)</span>
        </div>

        {/* Scrollable log area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto min-h-0 font-mono text-[11px] space-y-px py-1"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {connected ? "Waiting for events…" : "Connecting to NATS…"}
            </p>
          ) : (
            logs.map((entry) => {
              const time = entry.ts.slice(11, 23);
              if (entry.kind === "heartbeat") {
                const hb = entry.data as HeartbeatEvent;
                const ok = hb.is_connected ?? hb.is_running ?? false;
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-2 py-0.5 rounded hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {time}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 shrink-0 border-purple-400 text-purple-600"
                    >
                      HB
                    </Badge>
                    <span
                      className={
                        ok ? "text-green-600" : "text-muted-foreground"
                      }
                    >
                      {ok ? "connected" : "disconnected"}
                    </span>
                    <span className="text-muted-foreground">
                      msgs:{hb.message_count} errs:{hb.error_count}
                      {hb.broker ? ` broker:${hb.broker}` : ""}
                      {hb.topics?.length
                        ? ` topics:[${hb.topics.join(",")}]`
                        : ""}
                    </span>
                  </div>
                );
              }
              if (entry.kind === "raw_ingest") {
                const ri = entry.data as RawIngestEvent;
                const preview = ri.payload_hex
                  ? ri.payload_hex.slice(0, 32) +
                    (ri.payload_hex.length > 32 ? "…" : "")
                  : "";
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-2 py-0.5 rounded hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {time}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 shrink-0 border-amber-400 text-amber-600"
                    >
                      RX
                    </Badge>
                    <span className="text-foreground">dev:{ri.device_key}</span>
                    <span className="text-muted-foreground truncate">
                      {ri.topic ? `[${ri.topic}]` : ""} {ri.payload_size}B
                      {preview ? ` 0x${preview}` : ""}
                    </span>
                  </div>
                );
              }
              if (entry.kind === "output_ack") {
                const oa = entry.data as OutputAckEvent;
                return (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-2 py-0.5 rounded hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {time}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 shrink-0 border-green-400 text-green-600"
                    >
                      TX
                    </Badge>
                    <span className="text-green-600">
                      {oa.count} record{oa.count !== 1 ? "s" : ""} written
                    </span>
                    {oa.device_key != null && (
                      <span className="text-muted-foreground">
                        dev:{oa.device_key}
                      </span>
                    )}
                  </div>
                );
              }
              return null;
            })
          )}
        </div>

        <SheetFooter className="flex-none pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => setLogs([])}>
            Clear
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AllIntegrationsTab({
  token,
  isSuperAdmin,
  orgId,
}: {
  token: string;
  isSuperAdmin: boolean;
  orgId: number | null;
}) {
  const [integrations, setIntegrations] = React.useState<AdminIntegration[]>(
    [],
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  const [providers, setProviders] = React.useState<IntegrationProvider[]>([]);
  const [teams, setTeams] = React.useState<Array<{ id: number; name: string }>>(
    [],
  );
  const [orgs, setOrgs] = React.useState<Array<{ id: number; name: string }>>(
    [],
  );

  // Create state
  const [showCreate, setShowCreate] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createType, setCreateType] = React.useState<string>("input.mqtt");
  const [createDirection, setCreateDirection] = React.useState<
    "input" | "output"
  >("input");
  const [createProviderId, setCreateProviderId] = React.useState<string>("");
  const [createAccessLevel, setCreateAccessLevel] = React.useState<
    "org" | "team" | "public"
  >("org");
  const [createTeamId, setCreateTeamId] = React.useState<string>("");
  const [createOrgId, setCreateOrgId] = React.useState<string>(
    orgId ? String(orgId) : "",
  );
  const [createConfig, setCreateConfig] = React.useState<
    Record<string, string>
  >({});
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Edit state
  const [editTarget, setEditTarget] = React.useState<AdminIntegration | null>(
    null,
  );
  const [showEdit, setShowEdit] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editIsActive, setEditIsActive] = React.useState(true);
  const [editIsGlobal, setEditIsGlobal] = React.useState(false);
  const [editProviderId, setEditProviderId] = React.useState<string>("");
  const [editConfig, setEditConfig] = React.useState<Record<string, string>>(
    {},
  );
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] =
    React.useState<AdminIntegration | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // Logs panel state
  const [logsTarget, setLogsTarget] = React.useState<AdminIntegration | null>(
    null,
  );

  // Test state
  const [testingId, setTestingId] = React.useState<number | null>(null);
  const [testResults, setTestResults] = React.useState<
    Record<number, "ok" | "fail" | "testing">
  >({});

  // Live connection status (polled from NATS heartbeat cache)
  const [statuses, setStatuses] = React.useState<
    Record<number, IntegrationStatus>
  >({});

  React.useEffect(() => {
    if (!token) return;
    const fetchStatuses = () => {
      fetch(`${API}/api/v1/services/statuses`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (r) => {
          if (!r.ok) return;
          const json = await r.json();
          if (json.success)
            setStatuses(json.data as Record<number, IntegrationStatus>);
        })
        .catch(() => {});
    };
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 15_000);
    return () => clearInterval(interval);
  }, [token]);

  // Called by LiveMessagesPanel when a heartbeat/tombstone event arrives —
  // updates integration statuses in real-time without waiting for the poll interval.
  const handleHeartbeatStatus = React.useCallback((hb: HeartbeatEvent) => {
    setStatuses((prev) => ({
      ...prev,
      [hb.service_id]: {
        service_id: hb.service_id,
        service_type: hb.service_type,
        is_connected: hb.is_connected ?? false,
        message_count: hb.message_count,
        error_count: hb.error_count,
        broker: hb.broker,
        last_message_at:
          hb.last_message_at ?? prev[hb.service_id]?.last_message_at ?? "",
        reported_at: hb.reported_at,
      } satisfies IntegrationStatus,
    }));
  }, []);

  // Load providers
  React.useEffect(() => {
    fetch(`${API}/api/v1/service-providers`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success) setProviders(json.data as IntegrationProvider[]);
      })
      .catch(() => {});
  }, []);

  // Load teams (for access level selector)
  React.useEffect(() => {
    if (!token) return;
    const teamsUrl = isSuperAdmin
      ? `${API}/api/v1/teams`
      : orgId
        ? `${API}/api/v1/orgs/${orgId}/teams`
        : null;
    if (!teamsUrl) return;
    fetch(teamsUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success)
          setTeams(json.data as Array<{ id: number; name: string }>);
      })
      .catch(() => {});
  }, [token, isSuperAdmin, orgId]);

  // Load orgs list (for superAdmin org selector in create form)
  React.useEffect(() => {
    if (!token || !isSuperAdmin) return;
    fetch(`${API}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json();
        if (json.success)
          setOrgs(json.data as Array<{ id: number; name: string }>);
      })
      .catch(() => {});
  }, [token, isSuperAdmin]);

  // Load integrations
  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    const qs = !isSuperAdmin && orgId ? `?org_id=${orgId}` : "";
    fetch(`${API}/api/v1/services${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        setIntegrations(
          (json.data as AdminIntegration[]).map((item) => ({
            ...item,
            type: item.service_type.split(".")[1] ?? item.service_type,
            direction: item.service_type.split(".")[0] ?? "input",
          })),
        );
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [token, isSuperAdmin, orgId]);

  // When editTarget changes, populate edit state
  React.useEffect(() => {
    if (editTarget) {
      setEditName(editTarget.name);
      setEditIsActive(editTarget.is_active ?? true);
      setEditIsGlobal(editTarget.is_global ?? false);
      setEditProviderId(
        editTarget.provider?.id ? String(editTarget.provider.id) : "",
      );
      // Populate config fields as strings for the form
      const cfg: Record<string, string> = {};
      if (editTarget.config) {
        for (const [k, v] of Object.entries(editTarget.config)) {
          if (v === null || v === undefined) continue;
          if (Array.isArray(v)) {
            // subscribe_topics array → remap to "topics" key expected by TopicsEditor
            cfg[k === "subscribe_topics" ? "topics" : k] = JSON.stringify(v);
          } else {
            cfg[k] = String(v);
          }
        }
      }
      setEditConfig(cfg);
      setEditError(null);
    }
  }, [editTarget]);

  async function handleCreate() {
    if (!createName.trim() || !createType) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = {
        name: createName.trim(),
        service_type: createType,
        config: createConfig,
      };
      if (createProviderId && createProviderId !== "__none__")
        body.provider_id = Number(createProviderId);
      if (createAccessLevel === "public") {
        body.is_global = true;
      } else if (createAccessLevel === "team" && createTeamId) {
        body.team_id = Number(createTeamId);
      }
      if (isSuperAdmin && createOrgId) {
        body.organization_id = Number(createOrgId);
      } else if (!isSuperAdmin && orgId) {
        body.organization_id = orgId;
      }
      const r = await fetch(`${API}/api/v1/services`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Create failed");
      setIntegrations((prev) => [
        ...prev,
        {
          ...(json.data as AdminIntegration),
          type:
            (json.data as AdminIntegration).service_type?.split(".")[1] ??
            createType.split(".")[1] ??
            createType,
          direction:
            (json.data as AdminIntegration).service_type?.split(".")[0] ??
            createType.split(".")[0] ??
            "input",
        },
      ]);
      setShowCreate(false);
      setCreateName("");
      setCreateType("input.mqtt");
      setCreateDirection("input");
      setCreateProviderId("");
      setCreateAccessLevel("org");
      setCreateTeamId("");
      setCreateOrgId(orgId ? String(orgId) : "");
      setCreateConfig({});
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleSave() {
    if (!editTarget) return;
    setSaving(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = {
        name: editName.trim() || undefined,
        is_active: editIsActive,
        is_global: editIsGlobal,
        config: editConfig,
      };
      if (editProviderId) body.provider_id = Number(editProviderId);
      else body.provider_id = null;
      const r = await fetch(`${API}/api/v1/services/${editTarget.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await r.json();
      if (!r.ok || !json.success)
        throw new Error(json.error ?? "Update failed");
      setIntegrations((prev) =>
        prev.map((i) =>
          i.id === editTarget.id
            ? {
                ...(json.data as AdminIntegration),
                type:
                  (json.data as AdminIntegration).service_type?.split(".")[1] ??
                  i.type,
                direction:
                  (json.data as AdminIntegration).service_type?.split(".")[0] ??
                  i.direction,
              }
            : i,
        ),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`${API}/api/v1/services/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setIntegrations((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      // silently ignore
    } finally {
      setDeleting(false);
    }
  }

  const handleTest = React.useCallback(
    async (id: number) => {
      setTestingId(id);
      setTestResults((prev) => ({ ...prev, [id]: "testing" }));
      try {
        const r = await fetch(`${API}/api/v1/services/${id}/test`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await r.json();
        setTestResults((prev) => ({
          ...prev,
          [id]: r.ok && json.success ? "ok" : "fail",
        }));
      } catch {
        setTestResults((prev) => ({ ...prev, [id]: "fail" }));
      } finally {
        setTestingId(null);
      }
    },
    [token],
  );

  const columns: ColumnDef<AdminIntegration>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-sm">{row.original.name}</div>
            {row.original.description && (
              <div className="text-xs text-muted-foreground line-clamp-1">
                {row.original.description}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ getValue }) => (
          <Badge variant="outline" className="text-xs">
            {INTEGRATION_TYPE_LABELS[getValue() as string] ??
              (getValue() as string)}
          </Badge>
        ),
      },
      {
        accessorKey: "direction",
        header: "Direction",
        cell: ({ getValue }) => {
          const d = getValue() as string;
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${INTEGRATION_DIRECTION_COLOURS[d] ?? ""}`}
            >
              {d}
            </Badge>
          );
        },
      },
      {
        accessorKey: "provider",
        header: "Provider",
        cell: ({ getValue }) => {
          const p = getValue() as AdminIntegration["provider"];
          return p ? (
            <span className="text-xs">{p.display_name}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "config_summary",
        header: "Config",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {configSummary(row.original.service_type, row.original.config)}
          </span>
        ),
      },
      {
        id: "connection",
        header: "Connection",
        cell: ({ row }) => {
          const s = statuses[row.original.id];
          if (!s) {
            return (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                Unknown
              </Badge>
            );
          }
          const isStale = s.reported_at
            ? Date.now() - new Date(s.reported_at).getTime() > 45_000
            : false;
          return (
            <div className="flex flex-col gap-0.5">
              {isStale ? (
                <Badge
                  variant="outline"
                  className="text-xs w-fit border-yellow-400 text-yellow-700 dark:border-yellow-600 dark:text-yellow-400"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-yellow-400" />
                  Stale
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={`text-xs w-fit ${
                    s.is_connected
                      ? "border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
                      : "border-red-400 text-red-700 dark:border-red-600 dark:text-red-400"
                  }`}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                      s.is_connected
                        ? "bg-green-500 animate-pulse"
                        : "bg-red-500"
                    }`}
                  />
                  {s.is_connected ? "Connected" : "Disconnected"}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums">
                ↑{s.message_count} / ✗{s.error_count}
              </span>
              {s.reported_at && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  Seen: {new Date(s.reported_at).toLocaleTimeString()}
                </span>
              )}
              {s.last_message_at && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  Msg: {new Date(s.last_message_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "is_active",
        header: "Status",
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge
              variant="outline"
              className="text-xs border-green-400 text-green-700 dark:border-green-600 dark:text-green-400"
            >
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Inactive
            </Badge>
          ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const i = row.original;
          const testResult = testResults[i.id];
          const testable = ["output.influxdb3", "output.http-push"].includes(
            i.service_type ?? "",
          );
          return (
            <div className="flex items-center gap-1">
              {testable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={testingId === i.id}
                  onClick={() => handleTest(i.id)}
                >
                  {testingId === i.id ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={12}
                      className="animate-spin"
                    />
                  ) : testResult === "ok" ? (
                    <span className="text-green-600">✓ OK</span>
                  ) : testResult === "fail" ? (
                    <span className="text-destructive">✗ Fail</span>
                  ) : (
                    "Test"
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                title="Live Logs"
                onClick={() => setLogsTarget(i)}
              >
                <HugeiconsIcon icon={ComputerTerminal01Icon} size={16} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditTarget(i);
                      setShowEdit(true);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Edit01Icon}
                      size={14}
                      className="mr-2"
                    />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(i)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={14}
                      className="mr-2"
                    />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [testResults, testingId, handleTest, statuses],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={integrations}
        filterKey="name"
        filterPlaceholder="Filter by name…"
        loading={loading}
        error={error}
        headerRight={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setCreateName("");
                setCreateType("input.mqtt");
                setCreateDirection("input");
                setCreateProviderId("");
                setCreateAccessLevel("org");
                setCreateTeamId("");
                setCreateOrgId(orgId ? String(orgId) : "");
                setCreateConfig({});
                setCreateError(null);
                setShowCreate(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              New Integration
            </Button>
            <Badge variant="secondary" className="tabular-nums">
              {integrations.length}
            </Badge>
          </div>
        }
      />

      <LiveMessagesPanel
        token={token}
        orgId={orgId}
        mode="integration"
        onHeartbeatEvent={handleHeartbeatStatus}
      />

      {/* Create Sheet */}
      <Sheet open={showCreate} onOpenChange={setShowCreate}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Integration</SheetTitle>
            <SheetDescription>
              Configure a new input or output integration endpoint.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="e.g. ChirpStack MQTT"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            {isSuperAdmin && (
              <div className="grid gap-1.5">
                <Label>Organization *</Label>
                <Select value={createOrgId} onValueChange={setCreateOrgId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an organization…" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Direction *</Label>
              <Select
                value={createDirection}
                onValueChange={(v) => {
                  setCreateDirection(v as "input" | "output");
                  setCreateType(v === "input" ? "input.mqtt" : "output.mqtt");
                  setCreateConfig({});
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="input">
                    Input (ingest from external)
                  </SelectItem>
                  <SelectItem value="output">
                    Output (push to external)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Type *</Label>
              <Select
                value={createType}
                onValueChange={(v) => {
                  setCreateType(v);
                  setCreateConfig({});
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_INTEGRATION_TYPES.filter((t) =>
                    t.startsWith(createDirection + "."),
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      {INTEGRATION_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Access Level</Label>
              <Select
                value={createAccessLevel}
                onValueChange={(v) => {
                  setCreateAccessLevel(v as "org" | "team" | "public");
                  setCreateTeamId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="org">
                    Organization (all members)
                  </SelectItem>
                  <SelectItem value="team">
                    Team (specific team only)
                  </SelectItem>
                  <SelectItem value="public">
                    Public (all organizations)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createAccessLevel === "team" && (
              <div className="grid gap-1.5">
                <Label>Team</Label>
                <Select value={createTeamId} onValueChange={setCreateTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a team…" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {createDirection === "input" && (
              <div className="grid gap-1.5">
                <Label>Provider (Parser)</Label>
                <Select
                  value={createProviderId || "__none__"}
                  onValueChange={(v) =>
                    setCreateProviderId(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None / custom" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None / custom</SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <IntegrationConfigForm
              type={createType}
              config={createConfig}
              onChange={setCreateConfig}
            />
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
            >
              {creating && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Create
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Integration</SheetTitle>
            <SheetDescription>
              {editTarget && (
                <span className="font-mono text-xs">
                  {INTEGRATION_TYPE_LABELS[editTarget.service_type] ??
                    editTarget.service_type}
                </span>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            {editTarget && directionForType(editTarget.type) === "input" && (
              <div className="grid gap-1.5">
                <Label>Provider (Parser)</Label>
                <Select
                  value={editProviderId || "__none__"}
                  onValueChange={(v) =>
                    setEditProviderId(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None / custom" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None / custom</SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={editIsActive ? "active" : "inactive"}
                onValueChange={(v) => setEditIsActive(v === "active")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editTarget && (
              <IntegrationConfigForm
                type={editTarget.service_type}
                config={editConfig}
                onChange={setEditConfig}
              />
            )}
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Integration</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <span className="font-semibold">{deleteTarget?.name}</span>
              ? This will also remove all associated configuration and any
              device references to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ServiceLogsPanel
        open={!!logsTarget}
        onClose={() => setLogsTarget(null)}
        integration={logsTarget}
        token={token}
        orgId={orgId}
      />
    </>
  );
}

/** Multi-topic add/remove editor for MQTT subscriber topics */
function TopicsEditor({
  config,
  onChange,
}: {
  config: Record<string, string>;
  onChange: (cfg: Record<string, string>) => void;
}) {
  const topics: string[] = React.useMemo(() => {
    try {
      const parsed = JSON.parse(config.topics || "[]");
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return config.topics ? [config.topics] : [];
    }
  }, [config.topics]);

  const [newTopic, setNewTopic] = React.useState("");

  function addTopic() {
    const t = newTopic.trim();
    if (!t) return;
    onChange({ ...config, topics: JSON.stringify([...topics, t]) });
    setNewTopic("");
  }

  function removeTopic(i: number) {
    onChange({
      ...config,
      topics: JSON.stringify(topics.filter((_, idx) => idx !== i)),
    });
  }

  return (
    <div className="grid gap-1.5">
      <Label>Topics</Label>
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {topics.map((t) => (
            <div
              key={t}
              className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-xs font-mono"
            >
              <span>{t}</span>
              <button
                type="button"
                onClick={() => removeTopic(topics.indexOf(t))}
                className="text-muted-foreground hover:text-destructive ml-1 leading-none"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {topics.length === 0 && (
        <p className="text-xs text-muted-foreground mb-1">
          No topics added yet.
        </p>
      )}
      <div className="flex gap-2">
        <Input
          placeholder="application/+/device/+/event/up"
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTopic();
            }
          }}
          className="flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addTopic}
          disabled={!newTopic.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

/** Dynamic config form rendered based on integration type */
function IntegrationConfigForm({
  type,
  config,
  onChange,
}: {
  type: string;
  config: Record<string, string>;
  onChange: (cfg: Record<string, string>) => void;
}) {
  function field(
    key: string,
    label: string,
    placeholder?: string,
    inputType = "text",
  ) {
    return (
      <div className="grid gap-1.5" key={key}>
        <Label>{label}</Label>
        <Input
          type={inputType}
          placeholder={placeholder}
          value={config[key] ?? ""}
          onChange={(e) => onChange({ ...config, [key]: e.target.value })}
        />
      </div>
    );
  }

  switch (type) {
    case "input.grpc-server":
    case "input.grpc-pull":
    case "output.grpc-push":
      return (
        <>
          {field(
            "host",
            type === "input.grpc-server" ? "Listen Host" : "Host",
            type === "input.grpc-server" ? "0.0.0.0" : "grpc.example.com",
          )}
          {field("port", "Port", "50051")}
          {field("service_name", "Service Name", "telemetry.TelemetryService")}
        </>
      );
    case "input.http-server":
      return (
        <>
          {field("listen_path", "Listen Path", "/ingest")}
          {field(
            "auth_type",
            "Auth Type",
            "none (none | bearer | basic | hmac)",
          )}
          {field(
            "auth_secret",
            "Auth Secret",
            "Leave blank for none",
            "password",
          )}
        </>
      );
    case "input.http-pull":
    case "output.http-push":
      return (
        <>
          {field("base_url", "Base URL *", "https://api.example.com")}
          {field("method", "Method", "POST")}
          {field("auth_type", "Auth Type", "none | bearer | basic | api-key")}
          {field(
            "auth_credentials",
            "Auth Credentials",
            "Bearer token or user:pass",
            "password",
          )}
          {field("timeout_sec", "Timeout (s)", "30")}
        </>
      );
    case "input.mqtt":
      return (
        <>
          {field("host", "Broker Host *", "mqtt.example.com")}
          {field("port", "Port", "1883")}
          {field("username", "Username")}
          {field("password", "Password", "", "password")}
          <TopicsEditor config={config} onChange={onChange} />
          {field(
            "publish_topic_template",
            "Publish Topic Template",
            "application/{application_id}/device/{dev_eui}/command/down",
          )}
        </>
      );
    case "output.mqtt":
      return (
        <>
          {field("host", "Broker Host *", "mqtt.example.com")}
          {field("port", "Port", "1883")}
          {field("username", "Username")}
          {field("password", "Password", "", "password")}
          {field(
            "publish_topic_template",
            "Publish Topic Template",
            "devices/{device_key}/data",
          )}
        </>
      );
    case "output.influxdb3":
      return (
        <>
          {field("host", "Host *", "https://influxdb.example.com")}
          {field("port", "Port", "8086")}
          {field("token", "API Token", "", "password")}
          {field("influxdb_org", "Org")}
          {field("bucket", "Bucket *", "telemetry")}
          {field("measurement", "Measurement", "telemetry")}
        </>
      );
    case "output.clickhouse":
      return (
        <>
          {field("host", "Host *", "clickhouse.example.com")}
          {field("port", "Port", "9000")}
          {field("database", "Database", "default")}
          {field("username", "Username", "default")}
          {field("password", "Password", "", "password")}
          {field("table_name", "Table", "telemetry")}
        </>
      );
    default:
      return null;
  }
}
// ─── Tab: Plan Limits (superAdmin only) ───────────────────────────────────────

function limitLabel(n: number) {
  if (n === -1)
    return (
      <span className="text-green-700 dark:text-green-400 font-medium">
        Unlimited
      </span>
    );
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  return <span className="tabular-nums">{n}</span>;
}

function PlanLimitsTab({ token }: { token: string }) {
  const [configs, setConfigs] = React.useState<AdminPlanConfig[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const loaded = React.useRef(false);

  // Action state
  const [editTarget, setEditTarget] = React.useState<AdminPlanConfig | null>(
    null,
  );
  const [showEdit, setShowEdit] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [editMaxOrgs, setEditMaxOrgs] = React.useState("");
  const [editMaxTeams, setEditMaxTeams] = React.useState("");
  const [editMaxApps, setEditMaxApps] = React.useState("");
  const [editMaxDevices, setEditMaxDevices] = React.useState("");
  const [editMaxMembers, setEditMaxMembers] = React.useState("");

  React.useEffect(() => {
    if (editTarget) {
      setEditMaxOrgs(String(editTarget.max_orgs));
      setEditMaxTeams(String(editTarget.max_teams_per_org));
      setEditMaxApps(String(editTarget.max_apps_per_team));
      setEditMaxDevices(String(editTarget.max_devices_per_team));
      setEditMaxMembers(String(editTarget.max_members_per_org));
    }
  }, [editTarget]);

  React.useEffect(() => {
    if (loaded.current || !token) return;
    loaded.current = true;
    setLoading(true);
    fetch(`${API}/api/v1/plan-config`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? "API error");
        const parsed = z.array(planConfigSchema).safeParse(json.data);
        if (parsed.success) setConfigs(parsed.data);
        else {
          console.error("Plan config parse error:", parsed.error.flatten());
          setError("Unexpected response shape — check console");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSavePlan() {
    if (!editTarget) return;
    setSaving(true);
    setActionError(null);
    try {
      const body = {
        max_orgs: Number(editMaxOrgs),
        max_teams_per_org: Number(editMaxTeams),
        max_apps_per_team: Number(editMaxApps),
        max_devices_per_team: Number(editMaxDevices),
        max_members_per_org: Number(editMaxMembers),
      };
      const r = await fetch(`${API}/api/v1/plan-config/${editTarget.plan}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.success) throw new Error(json.error ?? "Update failed");
      setConfigs((prev) =>
        prev.map((c) => (c.plan === editTarget.plan ? { ...c, ...body } : c)),
      );
      setShowEdit(false);
      setEditTarget(null);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: ColumnDef<AdminPlanConfig>[] = React.useMemo(
    () => [
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ getValue }) => {
          const v = (getValue() as string) ?? "";
          return (
            <Badge
              variant="outline"
              className={`text-xs capitalize ${PLAN_COLOUR[v] ?? ""}`}
            >
              {v}
            </Badge>
          );
        },
      },
      {
        accessorKey: "max_orgs",
        header: "Max Orgs",
        cell: ({ getValue }) => limitLabel(getValue() as number),
      },
      {
        accessorKey: "max_teams_per_org",
        header: "Max Teams / Org",
        cell: ({ getValue }) => limitLabel(getValue() as number),
      },
      {
        accessorKey: "max_apps_per_team",
        header: "Max Apps / Team",
        cell: ({ getValue }) => limitLabel(getValue() as number),
      },
      {
        accessorKey: "max_devices_per_team",
        header: "Max Devices / Team",
        cell: ({ getValue }) => limitLabel(getValue() as number),
      },
      {
        accessorKey: "max_members_per_org",
        header: "Max Members / Org",
        cell: ({ getValue }) => limitLabel(getValue() as number),
      },
      {
        accessorKey: "updated_at",
        header: "Last Updated",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(getValue() as string)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const c = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditTarget(c);
                    setShowEdit(true);
                    setActionError(null);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Edit Limits
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <DataTableShell
        columns={columns}
        data={configs}
        loading={loading}
        error={error}
      />

      {/* Edit Sheet */}
      <Sheet
        open={showEdit}
        onOpenChange={(o) => {
          setShowEdit(o);
          if (!o) setEditTarget(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Plan Limits</SheetTitle>
            <SheetDescription className="capitalize">
              {editTarget?.plan} plan — use -1 for unlimited
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label>Max Orgs</Label>
              <Input
                type="number"
                value={editMaxOrgs}
                onChange={(e) => setEditMaxOrgs(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Max Teams per Org</Label>
              <Input
                type="number"
                value={editMaxTeams}
                onChange={(e) => setEditMaxTeams(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Max Apps per Team</Label>
              <Input
                type="number"
                value={editMaxApps}
                onChange={(e) => setEditMaxApps(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Max Devices per Team</Label>
              <Input
                type="number"
                value={editMaxDevices}
                onChange={(e) => setEditMaxDevices(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Max Members per Org</Label>
              <Input
                type="number"
                value={editMaxMembers}
                onChange={(e) => setEditMaxMembers(e.target.value)}
              />
            </div>
            {actionError && (
              <p className="text-sm text-destructive">{actionError}</p>
            )}
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePlan} disabled={saving}>
              {saving && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="mr-2 animate-spin"
                />
              )}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Main exported component ───────────────────────────────────────────────────

const TAB_ICONS: Record<string, IconSvgElement> = {
  users: UserIcon,
  orgs: Building04Icon,
  teams: UserGroupIcon,
  apps: SquareIcon,
  devices: CpuIcon,
  "device-models": Database01Icon,
  vendors: Database01Icon,
  integrations: RouterIcon,
  profiles: RouterIcon,
  commands: ComputerTerminal01Icon,
  plans: Database01Icon,
};

const TAB_LABELS: Record<string, string> = {
  users: "Users",
  orgs: "Organizations",
  teams: "Teams",
  apps: "Applications",
  devices: "Devices",
  "device-models": "Device Models",
  vendors: "Vendors",
  integrations: "Integrations",
  profiles: "Int. Profiles",
  commands: "Commands",
  plans: "Plan Limits",
};

// Tabs visible to each role:
//   superAdmin   → all tabs + plans
//   all others   → all tabs except plans (scoped to their org by the API)
function visibleTabs(isSuperAdmin: boolean): string[] {
  if (isSuperAdmin)
    return [
      "users",
      "orgs",
      "teams",
      "apps",
      "devices",
      "device-models",
      "vendors",
      "integrations",
      "profiles",
      "commands",
      "plans",
    ];
  return [
    "users",
    "orgs",
    "teams",
    "apps",
    "devices",
    "device-models",
    "integrations",
    "profiles",
    "commands",
  ];
}

export function AdminDashboard() {
  const { session, isSuperAdmin, loading: authLoading } = useAuth();
  const token = session?.token ?? "";
  const orgId = session?.organizationId ?? null;
  const memberRole = session?.memberRole;
  const currentUserId = session?.userId;

  const tabs = React.useMemo(() => visibleTabs(isSuperAdmin), [isSuperAdmin]);

  const [activeTab, setActiveTab] = React.useState<string>(tabs[0] ?? "users");

  // If tabs change (e.g., after auth), reset to first available tab
  React.useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0] ?? "users");
  }, [tabs, activeTab]);

  if (authLoading) {
    return (
      <div className="px-4 lg:px-6 space-y-3 py-6">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton loading rows have no unique id
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="px-4 lg:px-6 py-12 text-center text-muted-foreground">
        Please log in to view the dashboard.
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-6 py-4">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {isSuperAdmin
            ? "Platform overview — all organizations"
            : session.organizationName
              ? `Viewing: ${session.organizationName}`
              : "No organization selected"}
          {" · "}
          <span className="capitalize">
            {memberRole ?? session.platformRole}
          </span>
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab] as IconSvgElement | undefined;
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                className="flex items-center gap-1.5 text-sm"
              >
                {Icon && <HugeiconsIcon icon={Icon} size={14} />}
                {TAB_LABELS[tab]}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {tabs.includes("users") && (
          <TabsContent value="users">
            <AllUsersTab
              token={token}
              isSuperAdmin={isSuperAdmin}
              orgId={orgId}
              currentUserId={currentUserId}
            />
          </TabsContent>
        )}

        {tabs.includes("orgs") && (
          <TabsContent value="orgs">
            <AllOrgsTab token={token} isSuperAdmin={isSuperAdmin} />
          </TabsContent>
        )}

        {tabs.includes("teams") && (
          <TabsContent value="teams">
            <AllTeamsTab
              token={token}
              isSuperAdmin={isSuperAdmin}
              orgId={orgId}
            />
          </TabsContent>
        )}

        {tabs.includes("apps") && (
          <TabsContent value="apps">
            <AllAppsTab
              token={token}
              isSuperAdmin={isSuperAdmin}
              orgId={orgId}
            />
          </TabsContent>
        )}

        {tabs.includes("devices") && (
          <TabsContent value="devices">
            <AllDevicesTab
              token={token}
              isSuperAdmin={isSuperAdmin}
              orgId={orgId}
            />
          </TabsContent>
        )}

        {tabs.includes("device-models") && (
          <TabsContent value="device-models">
            <AllDeviceModelsTab token={token} isSuperAdmin={isSuperAdmin} />
          </TabsContent>
        )}

        {tabs.includes("vendors") && (
          <TabsContent value="vendors">
            <AllVendorsTab token={token} />
          </TabsContent>
        )}

        {tabs.includes("integrations") && (
          <TabsContent value="integrations">
            <AllIntegrationsTab
              token={token}
              isSuperAdmin={isSuperAdmin}
              orgId={orgId}
            />
          </TabsContent>
        )}

        {tabs.includes("profiles") && (
          <TabsContent value="profiles">
            <IntegrationProfilesTab token={token} orgId={orgId} />
          </TabsContent>
        )}

        {tabs.includes("commands") && (
          <TabsContent value="commands">
            <CommandsTab token={token} orgId={orgId} />
          </TabsContent>
        )}

        {tabs.includes("plans") && (
          <TabsContent value="plans">
            <PlanLimitsTab token={token} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
