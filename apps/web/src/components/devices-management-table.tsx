"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  CheckmarkCircle01Icon,
  CpuIcon,
  LeftToRightListBulletIcon,
  Loading03Icon,
  MoreVerticalCircle01Icon,
  RouterIcon,
  WifiMediumSignalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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

// ─── Schemas ──────────────────────────────────────────────────────────────────

type DeviceEntry = {
  id: string;
  device_key?: string | null;
  device_model_id?: number | null;
  device_protocol?: string | null;
  eui?: string | null;
  mac_address?: string | null;
  vendor_name?: string | null;
  device_model_name?: string | null;
  device_model_code?: string | null;
  organization_id?: number | null;
  team_id?: number | null;
  is_active?: boolean | null;
  is_public?: boolean | null;
  is_global?: boolean | null;
  created_at: string;
};

type TransportEntry = {
  id: number;
  name: string;
  description?: string | null;
  organization_id?: number | null;
  team_id?: number | null;
  transport_type_id?: number | null;
  transport_type_code?: string | null;
  transport_type_name?: string | null;
  is_global?: boolean | null;
  is_active?: boolean | null;
  created_at: string;
};

type DeviceModel = {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  vendor_name: string;
  vendor_id: number;
  device_type_name?: string | null;
  protocol?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  active:
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  inactive: "bg-muted text-muted-foreground",
};
function boolBadge(v?: boolean | null) {
  return v ? (
    <Badge variant="outline" className={STATUS_COLOURS.active}>
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className={STATUS_COLOURS.inactive}>
      Inactive
    </Badge>
  );
}

// ─── Generic Table Shell ──────────────────────────────────────────────────────

function DataTableShell<T>({
  columns,
  data,
  loading,
  globalFilter,
  onGlobalFilter,
  actionLabel,
  onAction,
  emptyText = "No records found.",
}: {
  columns: ColumnDef<T>[];
  data: T[];
  loading: boolean;
  globalFilter: string;
  onGlobalFilter: (v: string) => void;
  actionLabel?: string;
  onAction?: () => void;
  emptyText?: string;
}) {
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: onGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search..."
            value={globalFilter}
            onChange={(e) => onGlobalFilter(e.target.value)}
            className="h-8 w-48"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <HugeiconsIcon icon={LeftToRightListBulletIcon} size={14} />
                Columns
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(!!v)}
                    className="capitalize"
                  >
                    {col.id.replace(/_/g, " ")}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {actionLabel && onAction && (
          <Button size="sm" onClick={onAction}>
            <HugeiconsIcon icon={Add01Icon} size={14} />
            {actionLabel}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border mx-4 lg:mx-6">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton loading rows have no unique id
                <TableRow key={i}>
                  {columns.map((_c, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton loading cells have no unique id
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
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
                  {loading ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={20}
                      className="mx-auto animate-spin"
                    />
                  ) : (
                    emptyText
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-4 lg:px-6">
        <span className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(v) => table.setPageSize(Number(v))}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[10, 20, 50].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} / page
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount() || 1}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <HugeiconsIcon icon={ArrowLeftDoubleIcon} size={14} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <HugeiconsIcon icon={ArrowRightDoubleIcon} size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Column definitions ───────────────────────────────────────────────────────

function deviceColumns(
  onDelete: (id: string) => void,
  onHardDelete: (id: string) => void,
): ColumnDef<DeviceEntry>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "device_key",
      header: "Device Key",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.device_key ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "vendor_name",
      header: "Vendor",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.vendor_name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "device_model_name",
      header: "Model",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.device_model_name ?? "—"}</span>
          {row.original.device_model_code && (
            <span className="text-xs text-muted-foreground font-mono">
              {row.original.device_model_code}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "device_protocol",
      header: "Protocol",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs capitalize">
          {row.original.device_protocol ?? "—"}
        </Badge>
      ),
    },
    {
      accessorKey: "eui",
      header: "EUI / MAC",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.eui ?? row.original.mac_address ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) => boolBadge(row.original.is_active),
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(row.original.id)}
            >
              Deactivate
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive font-semibold"
              onClick={() => onHardDelete(row.original.id)}
            >
              Delete permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}

function transportColumns(
  onDelete: (id: number) => void,
): ColumnDef<TransportEntry>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "transport_type_name",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.transport_type_code ??
            row.original.transport_type_name ??
            "—"}
        </Badge>
      ),
    },
    {
      accessorKey: "is_global",
      header: "Scope",
      cell: ({ row }) =>
        row.original.is_global ? (
          <Badge variant="outline" className="text-blue-500 border-blue-500/30">
            Global
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Org
          </Badge>
        ),
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) => boolBadge(row.original.is_active),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-48 block">
          {row.original.description ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(row.original.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}

function deviceModelColumns(): ColumnDef<DeviceModel>[] {
  return [
    {
      accessorKey: "vendor_name",
      header: "Vendor",
      cell: ({ row }) => (
        <span className="font-semibold">{row.original.vendor_name}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Model",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "device_type_name",
      header: "Device Type",
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.device_type_name ?? "—"}</Badge>
      ),
    },
    {
      accessorKey: "protocol",
      header: "Protocol",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground capitalize">
          {row.original.protocol ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-56 block">
          {row.original.description ?? "—"}
        </span>
      ),
    },
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DevicesManagementTable() {
  const { session } = useAuth();
  const orgId = session ? Number(session.organizationId) : null;
  // Platform admin (org 1 / "Admin") sees data across all organizations
  const isPlatformAdmin =
    session?.organizationName?.toLowerCase() === "admin" || orgId === 1;
  const headers = React.useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.token) h["Authorization"] = `Bearer ${session.token}`;
    return h;
  }, [session]);

  // ── Data state ──
  const [devices, setDevices] = React.useState<DeviceEntry[]>([]);
  const [transports, setTransports] = React.useState<TransportEntry[]>([]);
  const [deviceModels, setDeviceModels] = React.useState<DeviceModel[]>([]);

  const [loadingDevices, setLoadingDevices] = React.useState(true);
  const [loadingTransports, setLoadingTransports] = React.useState(true);
  const [loadingModels, setLoadingModels] = React.useState(true);

  // ── Reference data (for forms & filters) ──
  const [vendors, setVendors] = React.useState<
    { id: number; name: string; code: string }[]
  >([]);
  const [transportTypes, setTransportTypes] = React.useState<
    { id: number; code: string; display_name: string }[]
  >([]);
  const [teams, setTeams] = React.useState<
    { id: number; name: string; organization_id: number | null }[]
  >([]);

  // ── Global filter state ──
  const [deviceFilter, setDeviceFilter] = React.useState("");
  const [transportFilter, setTransportFilter] = React.useState("");
  const [modelFilter, setModelFilter] = React.useState("");
  const [vendorFilter, setVendorFilter] = React.useState<string>("all");
  const [typeFilter, setTypeFilter] = React.useState<string>("all");

  // ── Sheet / form state ──
  const [addDeviceOpen, setAddDeviceOpen] = React.useState(false);
  const [addTransportOpen, setAddTransportOpen] = React.useState(false);

  // Add Device form
  const [devForm, setDevForm] = React.useState({
    device_model_id: "",
    device_type: "lorawan" as "lorawan" | "ip" | "other",
    eui: "",
    mac_address: "",
    team_id: "",
    lns_provider_id: "",
    is_active: true,
    is_public: false,
    is_global: false,
  });
  const [devFormLoading, setDevFormLoading] = React.useState(false);
  const [devFormError, setDevFormError] = React.useState<string | null>(null);

  // Add Transport form
  const [trForm, setTrForm] = React.useState({
    name: "",
    description: "",
    transport_type_id: "",
    team_id: "",
    is_global: false,
    mqtt_host: "",
    mqtt_port: "1883",
    mqtt_username: "",
    mqtt_password: "",
    mqtt_topics: "",
    mqtt_qos: "0",
    mqtt_use_tls: false,
  });
  const [trFormLoading, setTrFormLoading] = React.useState(false);
  const [trFormError, setTrFormError] = React.useState<string | null>(null);

  const isLoraWAN = devForm.device_type === "lorawan";

  // ── Selected transport type code (for conditional MQTT fields) ──
  const selectedTransportCode = React.useMemo(
    () =>
      transportTypes.find((t) => t.id === Number(trForm.transport_type_id))
        ?.code ?? "",
    [trForm.transport_type_id, transportTypes],
  );
  const isMqtt = selectedTransportCode === "mqtt-subscriber";

  // ── Filtered device models (for models tab) ──
  const filteredModels = React.useMemo(() => {
    return deviceModels.filter((m) => {
      const vendorOk =
        vendorFilter === "all" || m.vendor_id === Number(vendorFilter);
      const typeOk =
        typeFilter === "all" || (m.device_type_name ?? "") === typeFilter;
      return vendorOk && typeOk;
    });
  }, [deviceModels, vendorFilter, typeFilter]);

  // ── Fetch functions ──
  const fetchDevices = React.useCallback(async () => {
    if (!session) return;
    setLoadingDevices(true);
    try {
      const url = isPlatformAdmin
        ? "/api/v1/devices"
        : `/api/v1/devices?org_id=${orgId}`;
      const r = await fetch(url, { headers });
      const d = await r.json();
      setDevices(
        (d.data ?? []).map((item: Record<string, unknown>) => ({
          id: String(item.id ?? ""),
          device_key: (item.device_key as string) ?? null,
          device_model_id:
            item.device_model_id != null ? Number(item.device_model_id) : null,
          device_protocol: (item.device_protocol as string) ?? null,
          eui: (item.eui as string) ?? null,
          mac_address: (item.mac_address as string) ?? null,
          vendor_name: (item.vendor_name as string) ?? null,
          device_model_name: (item.device_model_name as string) ?? null,
          device_model_code: (item.device_model_code as string) ?? null,
          organization_id:
            item.organization_id != null ? Number(item.organization_id) : null,
          team_id: item.team_id != null ? Number(item.team_id) : null,
          is_active: (item.is_active as boolean) ?? null,
          is_public: (item.is_public as boolean) ?? null,
          is_global: (item.is_global as boolean) ?? null,
          created_at: String(item.created_at ?? new Date().toISOString()),
        })),
      );
    } finally {
      setLoadingDevices(false);
    }
  }, [orgId, isPlatformAdmin, session, headers]);

  const fetchTransports = React.useCallback(async () => {
    if (!session) return;
    setLoadingTransports(true);
    try {
      const url = isPlatformAdmin
        ? "/api/v1/transport-registry"
        : `/api/v1/transport-registry?org_id=${orgId}`;
      const r = await fetch(url, { headers });
      const d = await r.json();
      setTransports(
        (d.data ?? []).map((item: Record<string, unknown>) => ({
          id: Number(item.id),
          name: String(item.name ?? ""),
          description: (item.description as string) ?? null,
          organization_id:
            item.organization_id != null ? Number(item.organization_id) : null,
          team_id: item.team_id != null ? Number(item.team_id) : null,
          transport_type_id:
            item.transport_type_id != null
              ? Number(item.transport_type_id)
              : null,
          transport_type_code: (item.transport_type_code as string) ?? null,
          transport_type_name: (item.transport_type_name as string) ?? null,
          is_global: (item.is_global as boolean) ?? null,
          is_active: (item.is_active as boolean) ?? null,
          created_at: String(item.created_at ?? new Date().toISOString()),
        })),
      );
    } finally {
      setLoadingTransports(false);
    }
  }, [orgId, isPlatformAdmin, session, headers]);

  const fetchDeviceModels = React.useCallback(async () => {
    setLoadingModels(true);
    try {
      const r = await fetch("/api/v1/device-models", { headers });
      const d = await r.json();
      setDeviceModels(
        (d.data ?? []).map((item: Record<string, unknown>) => ({
          id: Number(item.id),
          name: String(item.name ?? ""),
          code: String(item.code ?? ""),
          description: (item.description as string) ?? null,
          vendor_name: String(item.vendor_name ?? ""),
          vendor_id: Number(item.vendor_id),
          device_type_name: (item.device_type_name as string) ?? null,
          protocol: (item.protocol as string) ?? null,
        })),
      );
    } finally {
      setLoadingModels(false);
    }
  }, [headers]);

  const fetchReferenceData = React.useCallback(async () => {
    try {
      const [vendorsRes, transportTypesRes, teamsRes] = await Promise.all([
        fetch("/api/v1/device-vendors", { headers }),
        fetch("/api/v1/transport-types", { headers }),
        fetch("/api/v1/teams", { headers }),
      ]);
      const [vd, ttd, teamd] = await Promise.all([
        vendorsRes.json(),
        transportTypesRes.json(),
        teamsRes.json(),
      ]);
      setVendors(
        (vd.data ?? []).map((v: Record<string, unknown>) => ({
          id: Number(v.id),
          name: String(v.name ?? ""),
          code: String(v.code ?? ""),
        })),
      );
      setTransportTypes(
        (ttd.data ?? []).map((t: Record<string, unknown>) => ({
          id: Number(t.id),
          code: String(t.code ?? ""),
          display_name: String(t.display_name ?? ""),
        })),
      );
      setTeams(
        (teamd.data ?? []).map((t: Record<string, unknown>) => ({
          id: Number(t.id),
          name: String(t.name ?? ""),
          organization_id:
            t.organization_id != null ? Number(t.organization_id) : null,
        })),
      );
    } catch (e) {
      console.error("Failed to load reference data", e);
    }
  }, [headers]);

  React.useEffect(() => {
    fetchDevices();
    fetchTransports();
    fetchDeviceModels();
    fetchReferenceData();
  }, [fetchDevices, fetchTransports, fetchDeviceModels, fetchReferenceData]);

  // ── Handlers ──
  const handleDeleteDevice = React.useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/v1/devices/${id}`, { method: "DELETE", headers });
        await fetchDevices();
      } catch (e) {
        console.error(e);
      }
    },
    [headers, fetchDevices],
  );

  const [hardDeleteId, setHardDeleteId] = React.useState<string | null>(null);

  const handleHardDeleteDevice = React.useCallback((id: string) => {
    setHardDeleteId(id);
  }, []);

  const confirmHardDelete = React.useCallback(async () => {
    if (!hardDeleteId) return;
    try {
      await fetch(`/api/v1/devices/${hardDeleteId}/hard`, {
        method: "DELETE",
        headers,
      });
      await fetchDevices();
    } catch (e) {
      console.error(e);
    } finally {
      setHardDeleteId(null);
    }
  }, [hardDeleteId, headers, fetchDevices]);

  const handleDeleteTransport = React.useCallback(
    async (id: number) => {
      try {
        await fetch(`/api/v1/transport-registry/${id}`, {
          method: "DELETE",
          headers,
        });
        await fetchTransports();
      } catch (e) {
        console.error(e);
      }
    },
    [headers, fetchTransports],
  );

  const handleAddDevice = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!orgId) return;
      setDevFormError(null);
      setDevFormLoading(true);
      try {
        const body: Record<string, unknown> = {
          device_model_id: Number(devForm.device_model_id),
          device_type: devForm.device_type,
          organization_id: orgId,
          team_id: Number(devForm.team_id),
          is_active: devForm.is_active,
          is_public: devForm.is_public,
          is_global: devForm.is_global,
        };
        if (isLoraWAN && devForm.eui) body.eui = devForm.eui.trim();
        if (devForm.device_type === "ip" && devForm.mac_address)
          body.mac_address = devForm.mac_address.trim();
        if (devForm.lns_provider_id)
          body.lns_provider_id = Number(devForm.lns_provider_id);

        const r = await fetch("/api/v1/devices", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!d.success) {
          setDevFormError(d.error ?? "Failed to create device");
          return;
        }
        setAddDeviceOpen(false);
        setDevForm({
          device_model_id: "",
          device_type: "lorawan",
          eui: "",
          mac_address: "",
          team_id: "",
          lns_provider_id: "",
          is_active: true,
          is_public: false,
          is_global: false,
        });
        await fetchDevices();
      } catch (e) {
        setDevFormError((e as Error).message);
      } finally {
        setDevFormLoading(false);
      }
    },
    [devForm, orgId, isLoraWAN, headers, fetchDevices],
  );

  const handleAddTransport = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!orgId) return;
      setTrFormError(null);
      setTrFormLoading(true);
      try {
        const body: Record<string, unknown> = {
          name: trForm.name.trim(),
          description: trForm.description.trim() || undefined,
          organization_id: orgId,
          transport_type_id: Number(trForm.transport_type_id),
          is_global: trForm.is_global,
        };
        if (trForm.team_id) body.team_id = Number(trForm.team_id);
        if (isMqtt) {
          body.mqtt_host = trForm.mqtt_host.trim();
          body.mqtt_port = Number(trForm.mqtt_port) || 1883;
          if (trForm.mqtt_username) body.mqtt_username = trForm.mqtt_username;
          if (trForm.mqtt_password) body.mqtt_password = trForm.mqtt_password;
          if (trForm.mqtt_topics) {
            body.mqtt_topics = trForm.mqtt_topics
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
          }
          body.mqtt_qos = Number(trForm.mqtt_qos);
          body.mqtt_use_tls = trForm.mqtt_use_tls;
        }

        const r = await fetch("/api/v1/transport-registry", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!d.success) {
          setTrFormError(d.error ?? "Failed to create transport");
          return;
        }
        setAddTransportOpen(false);
        setTrForm({
          name: "",
          description: "",
          transport_type_id: "",
          team_id: "",
          is_global: false,
          mqtt_host: "",
          mqtt_port: "1883",
          mqtt_username: "",
          mqtt_password: "",
          mqtt_topics: "",
          mqtt_qos: "0",
          mqtt_use_tls: false,
        });
        await fetchTransports();
      } catch (e) {
        setTrFormError((e as Error).message);
      } finally {
        setTrFormLoading(false);
      }
    },
    [trForm, orgId, isMqtt, headers, fetchTransports],
  );

  // ── Column memos ──
  const devCols = React.useMemo(
    () => deviceColumns(handleDeleteDevice, handleHardDeleteDevice),
    [handleDeleteDevice, handleHardDeleteDevice],
  );
  const trCols = React.useMemo(
    () => transportColumns(handleDeleteTransport),
    [handleDeleteTransport],
  );
  const modelCols = React.useMemo(() => deviceModelColumns(), []);

  // ── Unique device type names for filter ──
  const uniqueTypes = React.useMemo(
    () =>
      Array.from(new Set(deviceModels.map((m) => m.device_type_name)))
        .filter((t): t is string => t != null)
        .sort(),
    [deviceModels],
  );

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 lg:px-6 py-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <HugeiconsIcon
          icon={WifiMediumSignalIcon}
          size={20}
          className="text-muted-foreground"
        />
        <h1 className="text-xl font-semibold">Devices</h1>
      </div>

      <Tabs defaultValue="devices" className="w-full">
        <TabsList className="mx-0">
          <TabsTrigger value="devices" className="flex items-center gap-1.5">
            <HugeiconsIcon icon={WifiMediumSignalIcon} size={14} />
            Device Registry
          </TabsTrigger>
          <TabsTrigger value="transports" className="flex items-center gap-1.5">
            <HugeiconsIcon icon={RouterIcon} size={14} />
            Transport Registry
          </TabsTrigger>
          <TabsTrigger value="models" className="flex items-center gap-1.5">
            <HugeiconsIcon icon={CpuIcon} size={14} />
            Device Models
          </TabsTrigger>
        </TabsList>

        {/* ── Devices Tab ── */}
        <TabsContent value="devices" className="mt-4">
          <DataTableShell
            columns={devCols}
            data={devices}
            loading={loadingDevices}
            globalFilter={deviceFilter}
            onGlobalFilter={setDeviceFilter}
            actionLabel="Add Device"
            onAction={() => setAddDeviceOpen(true)}
            emptyText="No devices registered in this organization."
          />
        </TabsContent>

        {/* ── Transports Tab ── */}
        <TabsContent value="transports" className="mt-4">
          <DataTableShell
            columns={trCols}
            data={transports}
            loading={loadingTransports}
            globalFilter={transportFilter}
            onGlobalFilter={setTransportFilter}
            actionLabel="Add Transport"
            onAction={() => setAddTransportOpen(true)}
            emptyText="No transport registry entries for this organization."
          />
        </TabsContent>

        {/* ── Device Models Tab ── */}
        <TabsContent value="models" className="mt-4">
          {/* Vendor + Type filters */}
          <div className="flex items-center gap-3 px-4 lg:px-6 mb-3">
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {uniqueTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(vendorFilter !== "all" || typeFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setVendorFilter("all");
                  setTypeFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          <DataTableShell
            columns={modelCols}
            data={filteredModels}
            loading={loadingModels}
            globalFilter={modelFilter}
            onGlobalFilter={setModelFilter}
            emptyText="No device models found."
          />
        </TabsContent>
      </Tabs>

      {/* ── Add Device Sheet ── */}
      <Sheet open={addDeviceOpen} onOpenChange={setAddDeviceOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Device</SheetTitle>
            <SheetDescription>
              Register a new device in the organization.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleAddDevice} className="flex flex-col gap-4 mt-4">
            {devFormError && (
              <div className="text-destructive text-sm bg-destructive/10 rounded p-2">
                {devFormError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-model">Device Model *</Label>
              <Select
                value={devForm.device_model_id}
                onValueChange={(v) =>
                  setDevForm((f) => ({ ...f, device_model_id: v }))
                }
                required
              >
                <SelectTrigger id="dev-model">
                  <SelectValue placeholder="Select model..." />
                </SelectTrigger>
                <SelectContent>
                  {deviceModels.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.vendor_name} — {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-type">Device Type *</Label>
              <Select
                value={devForm.device_type}
                onValueChange={(v) =>
                  setDevForm((f) => ({
                    ...f,
                    device_type: v as "lorawan" | "ip" | "other",
                    eui: "",
                    mac_address: "",
                  }))
                }
              >
                <SelectTrigger id="dev-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lorawan">
                    LoRaWAN (requires EUI)
                  </SelectItem>
                  <SelectItem value="ip">IP / MQTT (requires MAC)</SelectItem>
                  <SelectItem value="other">Other (no identifier)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {devForm.device_type === "lorawan" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dev-eui">EUI (16 hex chars) *</Label>
                <Input
                  id="dev-eui"
                  placeholder="e.g. 24E124535F318437"
                  value={devForm.eui}
                  onChange={(e) =>
                    setDevForm((f) => ({ ...f, eui: e.target.value }))
                  }
                  required
                  maxLength={16}
                  className="font-mono"
                />
              </div>
            )}
            {devForm.device_type === "ip" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dev-mac">MAC Address *</Label>
                <Input
                  id="dev-mac"
                  placeholder="e.g. A1:B2:C3:D4:E5:F6"
                  value={devForm.mac_address}
                  onChange={(e) =>
                    setDevForm((f) => ({ ...f, mac_address: e.target.value }))
                  }
                  required
                  className="font-mono"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-team">Team *</Label>
              <Select
                value={devForm.team_id}
                onValueChange={(v) => setDevForm((f) => ({ ...f, team_id: v }))}
                required
              >
                <SelectTrigger id="dev-team">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {teams
                    .filter((t) => t.organization_id === orgId)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dev-lns">LNS Provider ID (optional)</Label>
              <Input
                id="dev-lns"
                type="number"
                placeholder="Leave blank if none"
                value={devForm.lns_provider_id}
                onChange={(e) =>
                  setDevForm((f) => ({ ...f, lns_provider_id: e.target.value }))
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dev-active"
                  checked={devForm.is_active}
                  onCheckedChange={(v) =>
                    setDevForm((f) => ({ ...f, is_active: !!v }))
                  }
                />
                <Label htmlFor="dev-active">Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dev-public"
                  checked={devForm.is_public}
                  onCheckedChange={(v) =>
                    setDevForm((f) => ({ ...f, is_public: !!v }))
                  }
                />
                <Label htmlFor="dev-public">Public</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="dev-global"
                  checked={devForm.is_global}
                  onCheckedChange={(v) =>
                    setDevForm((f) => ({ ...f, is_global: !!v }))
                  }
                />
                <Label htmlFor="dev-global">Global</Label>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={devFormLoading}>
                {devFormLoading ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="animate-spin"
                  />
                ) : (
                  <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
                )}
                Add Device
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddDeviceOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Add Transport Sheet ── */}
      <Sheet open={addTransportOpen} onOpenChange={setAddTransportOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Transport</SheetTitle>
            <SheetDescription>
              Register a new transport in the organization.
            </SheetDescription>
          </SheetHeader>
          <form
            onSubmit={handleAddTransport}
            className="flex flex-col gap-4 mt-4"
          >
            {trFormError && (
              <div className="text-destructive text-sm bg-destructive/10 rounded p-2">
                {trFormError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-name">Name *</Label>
              <Input
                id="tr-name"
                placeholder="e.g. MQTT main broker"
                value={trForm.name}
                onChange={(e) =>
                  setTrForm((f) => ({ ...f, name: e.target.value }))
                }
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-desc">Description</Label>
              <Input
                id="tr-desc"
                placeholder="Optional description"
                value={trForm.description}
                onChange={(e) =>
                  setTrForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-type">Transport Type *</Label>
              <Select
                value={trForm.transport_type_id}
                onValueChange={(v) =>
                  setTrForm((f) => ({ ...f, transport_type_id: v }))
                }
                required
              >
                <SelectTrigger id="tr-type">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {transportTypes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tr-team">Team (optional)</Label>
              <Select
                value={trForm.team_id || "__none__"}
                onValueChange={(v) =>
                  setTrForm((f) => ({
                    ...f,
                    team_id: v === "__none__" ? "" : v,
                  }))
                }
              >
                <SelectTrigger id="tr-team">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="tr-global"
                checked={trForm.is_global}
                onCheckedChange={(v) =>
                  setTrForm((f) => ({ ...f, is_global: !!v }))
                }
              />
              <Label htmlFor="tr-global">Global (visible to all orgs)</Label>
            </div>

            {/* MQTT config (shown when mqtt-subscriber selected) */}
            {isMqtt && (
              <div className="flex flex-col gap-3 border rounded-lg p-3">
                <p className="text-sm font-medium">MQTT Configuration</p>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mqtt-host">MQTT Host *</Label>
                  <Input
                    id="tr-mqtt-host"
                    placeholder="e.g. broker.example.com"
                    value={trForm.mqtt_host}
                    onChange={(e) =>
                      setTrForm((f) => ({ ...f, mqtt_host: e.target.value }))
                    }
                    required={isMqtt}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mqtt-port">Port</Label>
                  <Input
                    id="tr-mqtt-port"
                    type="number"
                    placeholder="1883"
                    value={trForm.mqtt_port}
                    onChange={(e) =>
                      setTrForm((f) => ({ ...f, mqtt_port: e.target.value }))
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mqtt-user">Username</Label>
                  <Input
                    id="tr-mqtt-user"
                    placeholder="Optional"
                    value={trForm.mqtt_username}
                    onChange={(e) =>
                      setTrForm((f) => ({
                        ...f,
                        mqtt_username: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mqtt-pass">Password</Label>
                  <Input
                    id="tr-mqtt-pass"
                    type="password"
                    placeholder="Optional"
                    value={trForm.mqtt_password}
                    onChange={(e) =>
                      setTrForm((f) => ({
                        ...f,
                        mqtt_password: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mqtt-topics">
                    Topics (comma-separated)
                  </Label>
                  <Input
                    id="tr-mqtt-topics"
                    placeholder="e.g. devices/+/data, sensors/#"
                    value={trForm.mqtt_topics}
                    onChange={(e) =>
                      setTrForm((f) => ({ ...f, mqtt_topics: e.target.value }))
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-mqtt-qos">QoS Level</Label>
                  <Select
                    value={trForm.mqtt_qos}
                    onValueChange={(v) =>
                      setTrForm((f) => ({ ...f, mqtt_qos: v }))
                    }
                  >
                    <SelectTrigger id="tr-mqtt-qos">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — At most once</SelectItem>
                      <SelectItem value="1">1 — At least once</SelectItem>
                      <SelectItem value="2">2 — Exactly once</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tr-mqtt-tls"
                    checked={trForm.mqtt_use_tls}
                    onCheckedChange={(v) =>
                      setTrForm((f) => ({ ...f, mqtt_use_tls: !!v }))
                    }
                  />
                  <Label htmlFor="tr-mqtt-tls">Use TLS</Label>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={trFormLoading}>
                {trFormLoading ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="animate-spin"
                  />
                ) : (
                  <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
                )}
                Add Transport
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddTransportOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* ── Hard Delete Confirm ── */}
      <AlertDialog
        open={!!hardDeleteId}
        onOpenChange={(open) => {
          if (!open) setHardDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this device?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the device and all associated routing and
              telemetry records from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmHardDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
