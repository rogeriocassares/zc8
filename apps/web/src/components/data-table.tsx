"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  CheckmarkCircle01Icon,
  LeftToRightListBulletIcon,
  Loading03Icon,
  MoreVerticalCircle01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import * as React from "react";
import { z } from "zod";
import { CreateDeviceForm } from "@/components/create-device-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth-context";

export const schema = z.object({
  id: z.number(),
  device_key: z.string(),
  device_model_name: z.string().nullable().optional(),
  vendor_name: z.string().nullable().optional(),
  device_protocol: z.string().nullable().optional(),
  eui: z.string().nullable().optional(),
  mac_address: z.string().nullable().optional(),
  organization_id: z.number(),
  team_id: z.number().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
});

type Device = z.infer<typeof schema>;

const PROTOCOL_COLOURS: Record<string, string> = {
  lorawan: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  mqtt: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  http: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  zc2x: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  default: "bg-muted text-muted-foreground",
};

function protocolColour(protocol?: string | null) {
  if (!protocol) return PROTOCOL_COLOURS.default;
  const key = protocol.toLowerCase();
  return PROTOCOL_COLOURS[key] ?? PROTOCOL_COLOURS.default;
}

function DeviceDetailDrawer({ device }: { device: Device }) {
  const isMobile = useIsMobile();
  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button
          variant="link"
          className="w-fit px-0 font-mono text-sm text-foreground"
        >
          {device.device_key}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{device.device_key}</DrawerTitle>
          <DrawerDescription>
            {device.vendor_name} {device.device_model_name}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Label className="text-muted-foreground">Protocol</Label>
            <span>{device.device_protocol ?? "—"}</span>
            <Label className="text-muted-foreground">EUI</Label>
            <span className="font-mono">{device.eui ?? "—"}</span>
            <Label className="text-muted-foreground">MAC</Label>
            <span className="font-mono">{device.mac_address ?? "—"}</span>
            <Label className="text-muted-foreground">Status</Label>
            <span>{device.is_active ? "Active" : "Inactive"}</span>
            <Label className="text-muted-foreground">Created</Label>
            <span>{new Date(device.created_at).toLocaleString()}</span>
          </div>
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function columns(onDelete: (id: number) => void): ColumnDef<Device>[] {
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
      cell: ({ row }) => <DeviceDetailDrawer device={row.original} />,
    },
    {
      accessorKey: "vendor_name",
      header: "Vendor",
      cell: ({ row }) => <span>{row.original.vendor_name ?? "—"}</span>,
    },
    {
      accessorKey: "device_model_name",
      header: "Model",
      cell: ({ row }) => <span>{row.original.device_model_name ?? "—"}</span>,
    },
    {
      accessorKey: "device_protocol",
      header: "Protocol",
      cell: ({ row }) => {
        const p = row.original.device_protocol;
        if (!p) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge className={protocolColour(p)} variant="outline">
            {p}
          </Badge>
        );
      },
    },
    {
      accessorKey: "eui",
      header: "EUI / MAC",
      cell: ({ row }) => {
        const val = row.original.eui ?? row.original.mac_address;
        return <span className="font-mono text-xs">{val ?? "—"}</span>;
      },
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge
            variant="outline"
            className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} size={12} />
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactive
          </Badge>
        ),
    },
    {
      accessorKey: "created_at",
      header: "Created",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">
          {new Date(row.original.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7">
              <HugeiconsIcon icon={MoreVerticalCircle01Icon} size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                navigator.clipboard.writeText(row.original.device_key)
              }
            >
              Copy key
            </DropdownMenuItem>
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

export function DataTable() {
  const { session } = useAuth();
  const [data, setData] = React.useState<Device[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [addDeviceOpen, setAddDeviceOpen] = React.useState(false);
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [activeTab, setActiveTab] = React.useState("all");
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  });

  const fetchDevices = React.useCallback(async () => {
    if (!session?.organizationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/devices?org_id=${session.organizationId}`,
        {
          headers: { Authorization: `Bearer ${session.token}` },
        },
      );
      if (!res.ok) throw new Error("Failed to fetch devices");
      const json = await res.json();
      const rows: Device[] = (json.data ?? []).map(
        (d: Record<string, unknown>) => ({
          id: Number(d.id),
          device_key: String(d.device_key ?? ""),
          device_model_name: (d.device_model_name as string | null) ?? null,
          vendor_name: (d.vendor_name as string | null) ?? null,
          device_protocol: (d.device_protocol as string | null) ?? null,
          eui: (d.eui as string | null) ?? null,
          mac_address: (d.mac_address as string | null) ?? null,
          organization_id: Number(d.organization_id),
          team_id: d.team_id != null ? Number(d.team_id) : null,
          is_active: Boolean(d.is_active),
          created_at: String(d.created_at ?? new Date().toISOString()),
        }),
      );
      setData(rows);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [session?.organizationId, session?.token]);

  React.useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const filteredData = React.useMemo(() => {
    if (activeTab === "active") return data.filter((d) => d.is_active);
    if (activeTab === "inactive") return data.filter((d) => !d.is_active);
    return data;
  }, [data, activeTab]);

  const handleDelete = React.useCallback(
    async (id: number) => {
      try {
        await fetch(`/api/v1/devices/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session?.token}` },
        });
        await fetchDevices();
      } catch (err) {
        console.error(err);
      }
    },
    [session?.token, fetchDevices],
  );

  const tableCols = React.useMemo(() => columns(handleDelete), [handleDelete]);

  const table = useReactTable({
    data: filteredData,
    columns: tableCols,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex items-center justify-between px-4 lg:px-6">
        <Label className="text-base font-semibold">Device Registry</Label>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search devices..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
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
          <Button size="sm" onClick={() => setAddDeviceOpen(true)}>
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Add Device
          </Button>
        </div>
      </div>

      <TabsList className="mx-4 lg:mx-6">
        <TabsTrigger value="all">
          All
          <Badge variant="secondary" className="ml-1">
            {data.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="active">
          Active
          <Badge variant="secondary" className="ml-1">
            {data.filter((d) => d.is_active).length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="inactive">
          Inactive
          <Badge variant="secondary" className="ml-1">
            {data.filter((d) => !d.is_active).length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value={activeTab} className="relative flex flex-col gap-4">
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
                  <TableRow key={i}>
                    {tableCols.map((_c, j) => (
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
                    colSpan={tableCols.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {loading ? (
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        size={20}
                        className="mx-auto animate-spin"
                      />
                    ) : (
                      "No devices found."
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {table.getFilteredSelectedRowModel().rows.length} of{" "}
              {table.getFilteredRowModel().rows.length} row(s) selected
            </span>
          </div>
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
              {table.getPageCount()}
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
      </TabsContent>

      <Sheet open={addDeviceOpen} onOpenChange={setAddDeviceOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Device</SheetTitle>
            <SheetDescription>
              Register a new device in the organization registry.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <CreateDeviceForm
              organizationId={
                session?.organizationId != null
                  ? String(session.organizationId)
                  : undefined
              }
              onSuccess={() => {
                setAddDeviceOpen(false);
                fetchDevices();
              }}
              onCancel={() => setAddDeviceOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </Tabs>
  );
}
