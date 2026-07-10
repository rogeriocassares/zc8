"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  Building04Icon,
  CheckmarkCircle01Icon,
  Delete02Icon,
  Edit01Icon,
  LeftToRightListBulletIcon,
  Loading03Icon,
  MoreVerticalCircle01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
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
import { z } from "zod";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3333";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const platformUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  role: z.string().optional(),
  plan: z.enum(["user", "hobby", "pro", "premium", "enterprise"]).optional(),
  avatar_url: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  organizations: z
    .array(z.object({ id: z.number(), name: z.string() }))
    .default([]),
  teams: z.array(z.object({ id: z.number(), name: z.string() })).default([]),
});
type PlatformUser = z.infer<typeof platformUserSchema>;

const orgMemberSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  role_id: z.number(),
  email: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  role_name: z.string(),
  joined_at: z.string().nullable().optional(),
  invitation_status: z.string(),
});
type OrgMember = z.infer<typeof orgMemberSchema>;

const orgSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  owner_email: z.string().nullable().optional(),
});
type Org = z.infer<typeof orgSchema>;

const teamSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable().optional(),
  team_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  organization_id: z.number().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  owner_email: z.string().nullable().optional(),
});
type Team = z.infer<typeof teamSchema>;

const roleSchema = z.object({
  id: z.number(),
  name: z.string(),
  scope: z.string(),
  description: z.string().nullable().optional(),
});
type Role = z.infer<typeof roleSchema>;

const planConfigSchema = z.object({
  plan: z.string(),
  max_orgs: z.number(),
  max_teams_per_org: z.number(),
  max_apps_per_team: z.number(),
  max_devices_per_team: z.number(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
});
type PlanConfig = z.infer<typeof planConfigSchema>;

// ─── Style maps ───────────────────────────────────────────────────────────────

const PLATFORM_ROLE_COLOURS: Record<string, string> = {
  superAdmin:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  user: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const MEMBER_ROLE_COLOURS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  member:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const STATUS_COLOURS: Record<string, string> = {
  accepted:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  declined: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  active:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  suspended:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  expired: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  inactive: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(
  firstName?: string | null,
  lastName?: string | null,
  email?: string,
): string {
  if (firstName && lastName)
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  if (email) return email.slice(0, 2).toUpperCase();
  return "??";
}

function fullName(
  firstName?: string | null,
  lastName?: string | null,
  email?: string,
): string {
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  return email || "";
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Generic DataTable Shell ──────────────────────────────────────────────────

interface DataTableShellProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  filterKey?: string;
  filterPlaceholder?: string;
  loading?: boolean;
  headerRight?: React.ReactNode;
}

function DataTableShell<T>({
  columns,
  data,
  filterKey,
  filterPlaceholder,
  loading,
  headerRight,
}: DataTableShellProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

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
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    initialState: { pagination: { pageSize: 20 } },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {filterKey && (
          <Input
            placeholder={filterPlaceholder || "Filter…"}
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

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
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
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <HugeiconsIcon icon={ArrowLeftDoubleIcon} size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          </Button>
          <span className="px-2 text-sm">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <HugeiconsIcon icon={ArrowRightDoubleIcon} size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── User Detail Sheet ────────────────────────────────────────────────────────

type OrgMembership = {
  orgId: number;
  orgName: string;
  roleId: number;
  roleName: string;
  memberId: number;
};

interface UserDetailSheetProps {
  user: PlatformUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSuperAdmin: boolean;
  token: string;
  onChanged?: () => void;
}

function UserDetailSheet({
  user,
  open,
  onOpenChange,
  isSuperAdmin,
  token,
  onChanged,
}: UserDetailSheetProps) {
  const [memberships, setMemberships] = React.useState<OrgMembership[]>([]);
  const [loadingMemberships, setLoadingMemberships] = React.useState(false);

  React.useEffect(() => {
    if (!user || !open || user.organizations.length === 0) return;
    setLoadingMemberships(true);
    Promise.all(
      user.organizations.map(async (org) => {
        const res = await fetch(
          `${API}/api/v1/organizations/${org.id}/members`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return null;
        const json = await res.json();
        type RawMember = {
          id: number;
          user_id: string;
          role_id: number;
          role_name: string;
        };
        const member = (json.data as RawMember[]).find(
          (m) => m.user_id === user.id,
        );
        if (!member) return null;
        return {
          orgId: org.id,
          orgName: org.name,
          roleId: member.role_id,
          roleName: member.role_name,
          memberId: member.id,
        };
      }),
    )
      .then((results) =>
        setMemberships(results.filter(Boolean) as OrgMembership[]),
      )
      .finally(() => setLoadingMemberships(false));
  }, [user, open, token]);

  if (!user) return null;

  const name = fullName(user.first_name, user.last_name, user.email);

  async function removeFromOrg(orgId: number, memberId: number) {
    const res = await fetch(
      `${API}/api/v1/organizations/${orgId}/members/${memberId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      setMemberships((prev) => prev.filter((m) => m.memberId !== memberId));
      onChanged?.();
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={user.avatar_url ?? undefined} />
              <AvatarFallback>
                {initials(user.first_name, user.last_name, user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <SheetTitle className="text-left">{name}</SheetTitle>
              <SheetDescription className="text-left">
                {user.email}
              </SheetDescription>
              {user.role && (
                <Badge
                  className={`w-fit ${PLATFORM_ROLE_COLOURS[user.role] ?? "bg-gray-100 text-gray-700"}`}
                  variant="outline"
                >
                  {user.role === "superAdmin"
                    ? "Super Admin"
                    : user.role === "admin"
                      ? "Admin"
                      : "User"}
                </Badge>
              )}
            </div>
          </div>
        </SheetHeader>

        <Tabs defaultValue="memberships">
          <TabsList className="w-full">
            <TabsTrigger value="memberships" className="flex-1">
              <HugeiconsIcon icon={Building04Icon} size={14} className="mr-1" />{" "}
              Memberships ({user.organizations.length})
            </TabsTrigger>
            <TabsTrigger value="teams" className="flex-1">
              <HugeiconsIcon icon={UserGroupIcon} size={14} className="mr-1" />{" "}
              Teams ({user.teams.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="memberships" className="mt-4">
            {loadingMemberships ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : memberships.length > 0 ? (
              <div className="space-y-2">
                {memberships.map((m) => (
                  <div
                    key={m.memberId}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{m.orgName}</span>
                      <Badge
                        variant="outline"
                        className={`w-fit mt-1 text-xs ${MEMBER_ROLE_COLOURS[m.roleName.toLowerCase()] ?? ""}`}
                      >
                        {m.roleName}
                      </Badge>
                    </div>
                    {isSuperAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeFromOrg(m.orgId, m.memberId)}
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={14} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {user.organizations.map((org) => (
                  <div
                    key={org.id}
                    className="flex items-center rounded-md border p-3"
                  >
                    <HugeiconsIcon
                      icon={Building04Icon}
                      size={14}
                      className="mr-2 text-muted-foreground"
                    />
                    <span className="text-sm">{org.name}</span>
                  </div>
                ))}
                {user.organizations.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No organization memberships.
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="teams" className="mt-4">
            {user.teams.length > 0 ? (
              <div className="space-y-2">
                {user.teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center rounded-md border p-3"
                  >
                    <HugeiconsIcon
                      icon={UserGroupIcon}
                      size={14}
                      className="mr-2 text-muted-foreground"
                    />
                    <span className="text-sm">{team.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No team memberships.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Invite / Add Member Sheet ────────────────────────────────────────────────

interface InviteMemberSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSuperAdmin: boolean;
  token: string;
  orgId?: number | null;
  orgName?: string | null;
  orgs: Org[];
  roles: Role[];
  allUsers: PlatformUser[];
  onInvited?: () => void;
}

function InviteMemberSheet({
  open,
  onOpenChange,
  isSuperAdmin,
  token,
  orgId,
  orgName,
  orgs,
  roles: orgRoles,
  allUsers,
  onInvited,
}: InviteMemberSheetProps) {
  const [selectedOrgId, setSelectedOrgId] = React.useState<string>("");
  const [emailSearch, setEmailSearch] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState<string>("");
  const [selectedRoleId, setSelectedRoleId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setSelectedOrgId("");
      setEmailSearch("");
      setSelectedUserId("");
      setSelectedRoleId("");
      setError(null);
      setSuccess(false);
    } else if (orgId) {
      setSelectedOrgId(String(orgId));
    }
  }, [open, orgId]);

  const filteredUsers =
    emailSearch.length >= 2
      ? allUsers.filter((u) =>
          u.email.toLowerCase().includes(emailSearch.toLowerCase()),
        )
      : [];

  const effectiveOrgId = isSuperAdmin
    ? selectedOrgId
      ? Number(selectedOrgId)
      : null
    : orgId;

  const orgRoleList = orgRoles.filter((r) => r.scope === "organization");

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveOrgId || !selectedUserId || !selectedRoleId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/organizations/${effectiveOrgId}/members`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: selectedUserId,
            role_id: Number(selectedRoleId),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to add member");
      setSuccess(true);
      onInvited?.();
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Member to Organization</SheetTitle>
          <SheetDescription>
            Find a user by email and assign them a role.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleInvite} className="mt-6 flex flex-col gap-4">
          {isSuperAdmin ? (
            <div className="flex flex-col gap-1.5">
              <Label>Organization</Label>
              <Select
                value={selectedOrgId}
                onValueChange={setSelectedOrgId}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select organization…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {orgs.map((org) => (
                      <SelectItem key={org.id} value={String(org.id)}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ) : (
            orgName && (
              <div className="rounded-md border p-3 text-sm">
                Adding to: <span className="font-medium">{orgName}</span>
              </div>
            )
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Find User by Email</Label>
            <Input
              placeholder="Type email to search…"
              value={emailSearch}
              onChange={(e) => {
                setEmailSearch(e.target.value);
                setSelectedUserId("");
              }}
            />
            {filteredUsers.length > 0 && (
              <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(u.id);
                      setEmailSearch(u.email);
                    }}
                    className={`w-full flex items-center gap-2 p-2 text-left hover:bg-muted text-sm ${selectedUserId === u.id ? "bg-muted" : ""}`}
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">
                        {initials(u.first_name, u.last_name, u.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium">
                        {fullName(u.first_name, u.last_name, u.email)}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {u.email}
                      </div>
                    </div>
                    {selectedUserId === u.id && (
                      <HugeiconsIcon
                        icon={CheckmarkCircle01Icon}
                        size={14}
                        className="ml-auto text-green-600"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
            {emailSearch.length >= 2 && filteredUsers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No users found. They may need to register first.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Organization Role</Label>
            <Select
              value={selectedRoleId}
              onValueChange={setSelectedRoleId}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {orgRoleList.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} /> Member
              added successfully!
            </p>
          )}

          <Button
            type="submit"
            disabled={
              submitting ||
              !selectedUserId ||
              !selectedRoleId ||
              (!isSuperAdmin && !orgId) ||
              (isSuperAdmin && !selectedOrgId)
            }
            className="mt-2"
          >
            {submitting && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="mr-2 animate-spin"
              />
            )}
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-2" />
            Add Member
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Create User Sheet ────────────────────────────────────────────────────────

interface CreateUserSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onCreated?: () => void;
}

function CreateUserSheet({
  open,
  onOpenChange,
  token,
  onCreated,
}: CreateUserSheetProps) {
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [emailVerified, setEmailVerified] = React.useState(false);
  const [isActive, setIsActive] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setEmail("");
      setFirstName("");
      setLastName("");
      setPassword("");
      setEmailVerified(false);
      setIsActive(true);
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          password,
          email_verified: emailVerified,
          is_active: isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to create user");
      setSuccess(true);
      onCreated?.();
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create New User</SheetTitle>
          <SheetDescription>
            Create a new platform user account.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-email">Email *</Label>
            <Input
              id="cu-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-first">First Name</Label>
              <Input
                id="cu-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cu-last">Last Name</Label>
              <Input
                id="cu-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cu-pass">Password *</Label>
            <Input
              id="cu-pass"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
            />
          </div>
          <div className="rounded-md border p-4 flex flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Account Status
            </p>
            <div className="flex items-center gap-3">
              <Checkbox
                id="cu-email-verified"
                checked={emailVerified}
                onCheckedChange={(v) => setEmailVerified(v === true)}
              />
              <div className="flex flex-col">
                <Label htmlFor="cu-email-verified" className="cursor-pointer">
                  Email Verified
                </Label>
                <span className="text-xs text-muted-foreground">
                  Mark email as already verified
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="cu-is-active"
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v === true)}
              />
              <div className="flex flex-col">
                <Label htmlFor="cu-is-active" className="cursor-pointer">
                  Active Account
                </Label>
                <span className="text-xs text-muted-foreground">
                  Allow user to log in immediately
                </span>
              </div>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} /> User
              created successfully!
            </p>
          )}
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="mr-2 animate-spin"
              />
            )}
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-2" />
            Create User
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Manage User Access Sheet ─────────────────────────────────────────────────

const PLAN_OPTIONS = [
  { value: "user", label: "User" },
  { value: "hobby", label: "Hobby" },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
  { value: "enterprise", label: "Enterprise" },
] as const;

const PLAN_COLOURS: Record<string, string> = {
  user: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  hobby: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  pro: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  premium:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  enterprise:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

type OrgAccessInfo = {
  orgId: number;
  orgName: string;
  orgPlan: string;
  memberId: number;
  roleId: number;
  roleName: string;
};

type TeamAccessInfo = {
  teamId: number;
  teamName: string;
  orgId: number;
  teamMemberId: number;
  roleId: number;
  roleName: string;
};

interface ManageUserAccessSheetProps {
  user: PlatformUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSuperAdmin: boolean;
  token: string;
  orgs: Org[];
  allTeams: Team[];
  roles: Role[];
  onChanged?: () => void;
}

function ManageUserAccessSheet({
  user,
  open,
  onOpenChange,
  isSuperAdmin,
  token,
  orgs,
  allTeams,
  roles,
  onChanged,
}: ManageUserAccessSheetProps) {
  const [orgAccess, setOrgAccess] = React.useState<OrgAccessInfo[]>([]);
  const [teamAccess, setTeamAccess] = React.useState<TeamAccessInfo[]>([]);
  const [loading, setLoading] = React.useState(false);

  // "Add to org" form state
  const [addOrgId, setAddOrgId] = React.useState("");
  const [addOrgRoleId, setAddOrgRoleId] = React.useState("");
  const [showAddOrg, setShowAddOrg] = React.useState(false);
  const [addOrgSubmitting, setAddOrgSubmitting] = React.useState(false);
  const [addOrgError, setAddOrgError] = React.useState<string | null>(null);

  // "Add to team" form state (per org — keyed by orgId)
  const [showAddTeamForOrg, setShowAddTeamForOrg] = React.useState<
    number | null
  >(null);
  const [orgTeams, setOrgTeams] = React.useState<Record<number, Team[]>>({});
  const [addTeamId, setAddTeamId] = React.useState("");
  const [addTeamRoleId, setAddTeamRoleId] = React.useState("");
  const [addTeamSubmitting, setAddTeamSubmitting] = React.useState(false);
  const [addTeamError, setAddTeamError] = React.useState<string | null>(null);

  const authHeader = React.useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  // Load memberships when sheet opens
  React.useEffect(() => {
    if (!open || !user) {
      setOrgAccess([]);
      setTeamAccess([]);
      setShowAddOrg(false);
      setAddOrgId("");
      setAddOrgRoleId("");
      setAddOrgError(null);
      setShowAddTeamForOrg(null);
      setOrgTeams({});
      setAddTeamId("");
      setAddTeamRoleId("");
      setAddTeamError(null);
      return;
    }
    setLoading(true);

    // Load org memberships + team memberships in parallel
    Promise.all([
      // Org memberships for user's orgs
      Promise.all(
        user.organizations.map(async (org) => {
          const orgData = orgs.find((o) => o.id === org.id);
          const res = await fetch(
            `${API}/api/v1/organizations/${org.id}/members`,
            { headers: authHeader },
          );
          if (!res.ok) return null;
          const json = await res.json();
          type RawMember = {
            id: number;
            user_id: string;
            role_id: number;
            role_name: string;
          };
          const member = (json.data as RawMember[]).find(
            (m) => m.user_id === user.id,
          );
          if (!member) return null;
          return {
            orgId: org.id,
            orgName: org.name,
            orgPlan: orgData?.plan ?? "hobby",
            memberId: member.id,
            roleId: member.role_id,
            roleName: member.role_name,
          } as OrgAccessInfo;
        }),
      ),
      // Team memberships
      Promise.all(
        user.teams.map(async (team) => {
          const teamData = allTeams.find((t) => t.id === team.id);
          if (!teamData?.organization_id) return null;
          const orgId = teamData.organization_id;
          const res = await fetch(
            `${API}/api/v1/orgs/${orgId}/teams/${team.id}/members`,
            { headers: authHeader },
          );
          if (!res.ok) return null;
          const json = await res.json();
          type RawTeamMember = {
            id: number;
            user_id: string;
            role_id: number;
            role_name: string;
          };
          const member = (json.data as RawTeamMember[]).find(
            (m) => m.user_id === user.id,
          );
          if (!member) return null;
          return {
            teamId: team.id,
            teamName: team.name,
            orgId,
            teamMemberId: member.id,
            roleId: member.role_id,
            roleName: member.role_name,
          } as TeamAccessInfo;
        }),
      ),
    ])
      .then(([orgResults, teamResults]) => {
        setOrgAccess(orgResults.filter(Boolean) as OrgAccessInfo[]);
        setTeamAccess(teamResults.filter(Boolean) as TeamAccessInfo[]);
      })
      .finally(() => setLoading(false));
  }, [open, user, orgs, allTeams, authHeader]);

  // Load teams for a given org on demand
  async function loadOrgTeams(orgId: number) {
    if (orgTeams[orgId]) return;
    const res = await fetch(`${API}/api/v1/orgs/${orgId}/teams`, {
      headers: authHeader,
    });
    if (!res.ok) return;
    const json = await res.json();
    const parsed = z.array(teamSchema).safeParse(json.data);
    if (parsed.success)
      setOrgTeams((prev) => ({ ...prev, [orgId]: parsed.data }));
  }

  async function handleRemoveFromOrg(orgId: number, memberId: number) {
    await fetch(`${API}/api/v1/organizations/${orgId}/members/${memberId}`, {
      method: "DELETE",
      headers: authHeader,
    });
    setOrgAccess((prev) => prev.filter((o) => o.memberId !== memberId));
    setTeamAccess((prev) => prev.filter((t) => t.orgId !== orgId));
    onChanged?.();
  }

  async function handleRemoveFromTeam(
    orgId: number,
    teamId: number,
    teamMemberId: number,
  ) {
    await fetch(
      `${API}/api/v1/orgs/${orgId}/teams/${teamId}/members/${teamMemberId}`,
      { method: "DELETE", headers: authHeader },
    );
    setTeamAccess((prev) =>
      prev.filter((t) => t.teamMemberId !== teamMemberId),
    );
    onChanged?.();
  }

  async function handleAddToOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !addOrgId || !addOrgRoleId) return;
    setAddOrgSubmitting(true);
    setAddOrgError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/organizations/${addOrgId}/members`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: user.id,
            role_id: Number(addOrgRoleId),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to add to organization");
      const orgData = orgs.find((o) => o.id === Number(addOrgId));
      const roleData = roles.find((r) => r.id === Number(addOrgRoleId));
      if (orgData && roleData) {
        setOrgAccess((prev) => [
          ...prev,
          {
            orgId: orgData.id,
            orgName: orgData.name,
            orgPlan: orgData.plan ?? "hobby",
            memberId: json.data?.id ?? Date.now(),
            roleId: roleData.id,
            roleName: roleData.name,
          },
        ]);
      }
      setAddOrgId("");
      setAddOrgRoleId("");
      setShowAddOrg(false);
      onChanged?.();
    } catch (err) {
      setAddOrgError((err as Error).message);
    } finally {
      setAddOrgSubmitting(false);
    }
  }

  async function handleAddToTeam(e: React.FormEvent, orgId: number) {
    e.preventDefault();
    if (!user || !addTeamId || !addTeamRoleId) return;
    setAddTeamSubmitting(true);
    setAddTeamError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/orgs/${orgId}/teams/${addTeamId}/members`,
        {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: user.id,
            role_id: Number(addTeamRoleId),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to add to team");
      const teamData = (orgTeams[orgId] ?? []).find(
        (t) => t.id === Number(addTeamId),
      );
      const roleData = roles.find((r) => r.id === Number(addTeamRoleId));
      if (teamData && roleData) {
        setTeamAccess((prev) => [
          ...prev,
          {
            teamId: teamData.id,
            teamName: teamData.name,
            orgId,
            teamMemberId: json.data?.id ?? Date.now(),
            roleId: roleData.id,
            roleName: roleData.name,
          },
        ]);
      }
      setAddTeamId("");
      setAddTeamRoleId("");
      setShowAddTeamForOrg(null);
      onChanged?.();
    } catch (err) {
      setAddTeamError((err as Error).message);
    } finally {
      setAddTeamSubmitting(false);
    }
  }

  if (!user) return null;

  const orgRoles = roles.filter((r) => r.scope === "organization");
  const teamRoles = roles.filter((r) => r.scope === "team");
  const memberOrgIds = new Set(orgAccess.map((o) => o.orgId));
  const availableOrgs = orgs.filter((o) => !memberOrgIds.has(o.id));

  const name = fullName(user.first_name, user.last_name, user.email);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[460px] sm:w-[560px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs">
                {initials(user.first_name, user.last_name, user.email)}
              </AvatarFallback>
            </Avatar>
            <div>
              <SheetTitle className="text-left">{name}</SheetTitle>
              <SheetDescription className="text-left text-xs">
                {user.email}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 mt-2">
            {/* ── Organizations ── */}
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Organizations &amp; Teams
            </p>

            {orgAccess.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Not a member of any organization.
              </p>
            )}

            {orgAccess.map((oa) => {
              const teamsInOrg = teamAccess.filter((t) => t.orgId === oa.orgId);
              const availableTeams = (orgTeams[oa.orgId] ?? []).filter(
                (t) => !teamsInOrg.some((ta) => ta.teamId === t.id),
              );
              const isAddingTeam = showAddTeamForOrg === oa.orgId;

              return (
                <div key={oa.orgId} className="rounded-lg border">
                  {/* Org row */}
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <HugeiconsIcon
                        icon={Building04Icon}
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                      <span className="text-sm font-medium">{oa.orgName}</span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${MEMBER_ROLE_COLOURS[oa.roleName.toLowerCase()] ?? ""}`}
                      >
                        {oa.roleName}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-xs ${PLAN_COLOURS[oa.orgPlan] ?? ""}`}
                      >
                        {PLAN_OPTIONS.find((p) => p.value === oa.orgPlan)
                          ?.label ?? oa.orgPlan}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                      title="Remove from org"
                      onClick={() => handleRemoveFromOrg(oa.orgId, oa.memberId)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={13} />
                    </Button>
                  </div>

                  {/* Teams in this org */}
                  <div className="border-t">
                    {teamsInOrg.map((ta) => (
                      <div
                        key={ta.teamMemberId}
                        className="flex items-center justify-between px-3 py-2 border-b last:border-b-0 bg-muted/30"
                      >
                        <div className="flex items-center gap-2 pl-4">
                          <HugeiconsIcon
                            icon={UserGroupIcon}
                            size={12}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="text-xs">{ta.teamName}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${MEMBER_ROLE_COLOURS[ta.roleName.toLowerCase()] ?? ""}`}
                          >
                            {ta.roleName}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                          title="Remove from team"
                          onClick={() =>
                            handleRemoveFromTeam(
                              ta.orgId,
                              ta.teamId,
                              ta.teamMemberId,
                            )
                          }
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={12} />
                        </Button>
                      </div>
                    ))}

                    {/* Add to team form / button */}
                    {isAddingTeam ? (
                      <form
                        onSubmit={(e) => handleAddToTeam(e, oa.orgId)}
                        className="p-3 flex flex-col gap-2 bg-muted/20"
                      >
                        <Select
                          value={addTeamId}
                          onValueChange={setAddTeamId}
                          required
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select team…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {availableTeams.map((t) => (
                                <SelectItem
                                  key={t.id}
                                  value={String(t.id)}
                                  className="text-xs"
                                >
                                  {t.name}
                                </SelectItem>
                              ))}
                              {availableTeams.length === 0 && (
                                <SelectItem
                                  value="__none__"
                                  disabled
                                  className="text-xs text-muted-foreground"
                                >
                                  No teams available
                                </SelectItem>
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Select
                          value={addTeamRoleId}
                          onValueChange={setAddTeamRoleId}
                          required
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select role…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {teamRoles.map((r) => (
                                <SelectItem
                                  key={r.id}
                                  value={String(r.id)}
                                  className="text-xs"
                                >
                                  {r.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {addTeamError && (
                          <p className="text-xs text-destructive">
                            {addTeamError}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={
                              addTeamSubmitting || !addTeamId || !addTeamRoleId
                            }
                          >
                            {addTeamSubmitting && (
                              <HugeiconsIcon
                                icon={Loading03Icon}
                                size={12}
                                className="mr-1 animate-spin"
                              />
                            )}
                            Add
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setShowAddTeamForOrg(null);
                              setAddTeamId("");
                              setAddTeamRoleId("");
                              setAddTeamError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors pl-7"
                        onClick={() => {
                          setShowAddTeamForOrg(oa.orgId);
                          setAddTeamId("");
                          setAddTeamRoleId("");
                          setAddTeamError(null);
                          loadOrgTeams(oa.orgId);
                        }}
                      >
                        <HugeiconsIcon icon={Add01Icon} size={12} />
                        Add to a team in {oa.orgName}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── Add to organization ── */}
            {availableOrgs.length > 0 && (
              <div>
                {showAddOrg ? (
                  <form
                    onSubmit={handleAddToOrg}
                    className="rounded-lg border p-3 flex flex-col gap-2"
                  >
                    <p className="text-xs font-medium">Add to Organization</p>
                    <Select
                      value={addOrgId}
                      onValueChange={setAddOrgId}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select organization…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {availableOrgs.map((o) => (
                            <SelectItem key={o.id} value={String(o.id)}>
                              {o.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Select
                      value={addOrgRoleId}
                      onValueChange={setAddOrgRoleId}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select role…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {orgRoles.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {addOrgError && (
                      <p className="text-sm text-destructive">{addOrgError}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          addOrgSubmitting || !addOrgId || !addOrgRoleId
                        }
                      >
                        {addOrgSubmitting && (
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            size={14}
                            className="mr-2 animate-spin"
                          />
                        )}
                        <HugeiconsIcon
                          icon={Add01Icon}
                          size={14}
                          className="mr-2"
                        />
                        Add
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowAddOrg(false);
                          setAddOrgId("");
                          setAddOrgRoleId("");
                          setAddOrgError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowAddOrg(true)}
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      size={14}
                      className="mr-2"
                    />
                    Add to Organization
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Set User Plan Sheet (superAdmin only) ─────────────────────────────────────

interface SetUserPlanSheetProps {
  user: PlatformUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  orgs: Org[];
  planConfigs: PlanConfig[];
  onChanged?: () => void;
}

function SetUserPlanSheet({
  user,
  open,
  onOpenChange,
  token,
  orgs,
  planConfigs,
  onChanged,
}: SetUserPlanSheetProps) {
  // User's own platform plan
  const [userPlan, setUserPlan] = React.useState<string>("user");
  const [savingUser, setSavingUser] = React.useState(false);
  const [userError, setUserError] = React.useState<string | null>(null);
  const [userSaved, setUserSaved] = React.useState(false);
  // Per-org plans
  const [planMap, setPlanMap] = React.useState<Record<number, string>>({});
  const [saving, setSaving] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<Record<number, string>>({});
  const [saved, setSaved] = React.useState<Record<number, boolean>>({});

  const authHeader = React.useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  React.useEffect(() => {
    if (!open || !user) return;
    setUserPlan(user.plan ?? "user");
    setUserError(null);
    setUserSaved(false);
    const map: Record<number, string> = {};
    for (const org of user.organizations) {
      const orgData = orgs.find((o) => o.id === org.id);
      map[org.id] = orgData?.plan ?? "hobby";
    }
    setPlanMap(map);
    setErrors({});
    setSaved({});
  }, [open, user, orgs]);

  async function handleSaveUserPlan() {
    if (!user) return;
    setSavingUser(true);
    setUserError(null);
    setUserSaved(false);
    try {
      const res = await fetch(`${API}/api/v1/users/${user.id}`, {
        method: "PUT",
        headers: authHeader,
        body: JSON.stringify({ plan: userPlan }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to update plan");
      setUserSaved(true);
      onChanged?.();
      setTimeout(() => setUserSaved(false), 2000);
    } catch (err) {
      setUserError((err as Error).message);
    } finally {
      setSavingUser(false);
    }
  }

  async function handleSavePlan(orgId: number) {
    const plan = planMap[orgId];
    if (!plan) return;
    setSaving(orgId);
    setErrors((prev) => ({ ...prev, [orgId]: "" }));
    setSaved((prev) => ({ ...prev, [orgId]: false }));
    try {
      const res = await fetch(`${API}/api/v1/organizations/${orgId}`, {
        method: "PUT",
        headers: authHeader,
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to update plan");
      setSaved((prev) => ({ ...prev, [orgId]: true }));
      onChanged?.();
      setTimeout(() => setSaved((prev) => ({ ...prev, [orgId]: false })), 2000);
    } catch (err) {
      setErrors((prev) => ({ ...prev, [orgId]: (err as Error).message }));
    } finally {
      setSaving(null);
    }
  }

  if (!user) return null;
  const name = fullName(user.first_name, user.last_name, user.email);

  const PLAN_ORDER: Record<string, number> = {
    user: 0,
    hobby: 1,
    pro: 2,
    premium: 3,
    enterprise: 4,
  };
  const isDowngrade =
    (PLAN_ORDER[userPlan] ?? 0) < (PLAN_ORDER[user.plan ?? "user"] ?? 0);
  const newPlanCfg = planConfigs.find((c) => c.plan === userPlan);

  const downgradeWarnings: string[] = [];
  if (isDowngrade && newPlanCfg) {
    const ownedOrgCount = user.organizations.length;
    if (newPlanCfg.max_orgs === 0 && ownedOrgCount > 0) {
      downgradeWarnings.push(
        `User has ${ownedOrgCount} organization(s) — "${userPlan}" plan allows none`,
      );
    } else if (newPlanCfg.max_orgs > 0 && ownedOrgCount > newPlanCfg.max_orgs) {
      downgradeWarnings.push(
        `User has ${ownedOrgCount} organizations — "${userPlan}" allows only ${newPlanCfg.max_orgs}`,
      );
    }
    if (newPlanCfg.max_teams_per_org > 0) {
      downgradeWarnings.push(
        `"${userPlan}" plan limits each org to ${newPlanCfg.max_teams_per_org} team(s)`,
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[460px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Set Plan</SheetTitle>
          <SheetDescription>
            Manage platform and organization subscription plans for{" "}
            <span className="font-medium">{name}</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 mt-4">
          {/* ── Platform Plan ── */}
          <div className="rounded-lg border p-3 flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Platform Plan
            </p>
            <div className="flex items-center gap-2">
              <Select value={userPlan} onValueChange={setUserPlan}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PLAN_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleSaveUserPlan}
                disabled={savingUser}
              >
                {savingUser ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={14}
                    className="animate-spin"
                  />
                ) : userSaved ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle01Icon}
                    size={14}
                    className="text-green-600"
                  />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
            {userError && (
              <p className="text-xs text-destructive">{userError}</p>
            )}
            {isDowngrade && downgradeWarnings.length > 0 && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-2 dark:bg-yellow-900/20 dark:border-yellow-800">
                <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                  Downgrade check:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {downgradeWarnings.map((w) => (
                    <li
                      key={w}
                      className="text-xs text-yellow-700 dark:text-yellow-400"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* ── Per-org Plans ── */}
          {user.organizations.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Organization Plans
              </p>
              {user.organizations.map((org) => (
                <div
                  key={org.id}
                  className="rounded-lg border p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2">
                    <HugeiconsIcon
                      icon={Building04Icon}
                      size={14}
                      className="text-muted-foreground"
                    />
                    <span className="text-sm font-medium">{org.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={planMap[org.id] ?? "hobby"}
                      onValueChange={(v) =>
                        setPlanMap((prev) => ({ ...prev, [org.id]: v }))
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PLAN_OPTIONS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => handleSavePlan(org.id)}
                      disabled={saving === org.id}
                    >
                      {saving === org.id ? (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          size={14}
                          className="animate-spin"
                        />
                      ) : saved[org.id] ? (
                        <HugeiconsIcon
                          icon={CheckmarkCircle01Icon}
                          size={14}
                          className="text-green-600"
                        />
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                  {errors[org.id] && (
                    <p className="text-xs text-destructive">{errors[org.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Plan Configuration Tab (superAdmin only) ─────────────────────────────────

interface PlanConfigTabProps {
  planConfigs: PlanConfig[];
  token: string;
  onSaved?: () => void;
}

function PlanConfigTab({ planConfigs, token, onSaved }: PlanConfigTabProps) {
  const [edits, setEdits] = React.useState<Record<string, Partial<PlanConfig>>>(
    {},
  );
  const [saving, setSaving] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState<Record<string, boolean>>({});

  const plans = ["user", "hobby", "pro", "premium", "enterprise"];

  function getCfg(plan: string): PlanConfig {
    const base = planConfigs.find((c) => c.plan === plan);
    return {
      plan,
      max_orgs: base?.max_orgs ?? -1,
      max_teams_per_org: base?.max_teams_per_org ?? -1,
      max_apps_per_team: base?.max_apps_per_team ?? -1,
      max_devices_per_team: base?.max_devices_per_team ?? -1,
    };
  }

  function getEdit(plan: string): PlanConfig {
    const base = getCfg(plan);
    return { ...base, ...edits[plan] };
  }

  function setField(
    plan: string,
    field: keyof PlanConfig,
    value: number | boolean,
  ) {
    setEdits((prev) => ({
      ...prev,
      [plan]: { ...prev[plan], [field]: value },
    }));
  }

  async function handleSave(plan: string) {
    setSaving(plan);
    setErrors((prev) => ({ ...prev, [plan]: "" }));
    setSaved((prev) => ({ ...prev, [plan]: false }));
    const cfg = getEdit(plan);
    try {
      const res = await fetch(`${API}/api/v1/plan-config/${plan}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          max_orgs: cfg.max_orgs,
          max_teams_per_org: cfg.max_teams_per_org,
          max_apps_per_team: cfg.max_apps_per_team,
          max_devices_per_team: cfg.max_devices_per_team,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Save failed");
      setSaved((prev) => ({ ...prev, [plan]: true }));
      onSaved?.();
      setTimeout(() => setSaved((prev) => ({ ...prev, [plan]: false })), 2000);
    } catch (err) {
      setErrors((prev) => ({ ...prev, [plan]: (err as Error).message }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Configure per-plan limits. Use{" "}
        <code className="text-xs bg-muted px-1 rounded">-1</code> for unlimited.
      </p>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                Plan
              </th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground">
                Max Orgs
              </th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground">
                Max Teams / Org
              </th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground">
                Max Apps / Team
              </th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground">
                Max Devices / App
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {plans.map((plan) => {
              const cfg = getEdit(plan);
              return (
                <tr
                  key={plan}
                  className="bg-background hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={`${PLAN_COLOURS[plan] ?? ""} capitalize`}
                    >
                      {plan}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Input
                      type="number"
                      min={-1}
                      value={cfg.max_orgs}
                      onChange={(e) =>
                        setField(plan, "max_orgs", Number(e.target.value))
                      }
                      className="w-20 mx-auto text-center h-8"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Input
                      type="number"
                      min={-1}
                      value={cfg.max_teams_per_org}
                      onChange={(e) =>
                        setField(
                          plan,
                          "max_teams_per_org",
                          Number(e.target.value),
                        )
                      }
                      className="w-20 mx-auto text-center h-8"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Input
                      type="number"
                      min={-1}
                      value={cfg.max_apps_per_team}
                      onChange={(e) =>
                        setField(
                          plan,
                          "max_apps_per_team",
                          Number(e.target.value),
                        )
                      }
                      className="w-20 mx-auto text-center h-8"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Input
                      type="number"
                      min={-1}
                      value={cfg.max_devices_per_team}
                      onChange={(e) =>
                        setField(
                          plan,
                          "max_devices_per_team",
                          Number(e.target.value),
                        )
                      }
                      className="w-20 mx-auto text-center h-8"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {errors[plan] && (
                        <span className="text-xs text-destructive">
                          {errors[plan]}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSave(plan)}
                        disabled={saving === plan}
                      >
                        {saving === plan ? (
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            size={14}
                            className="animate-spin"
                          />
                        ) : saved[plan] ? (
                          <HugeiconsIcon
                            icon={CheckmarkCircle01Icon}
                            size={14}
                            className="text-green-600"
                          />
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Upgrade My Plan Sheet (admin self-service) ────────────────────────────────

interface UpgradeMyPlanSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: string;
  userId: string;
  token: string;
  onChanged?: () => void;
}

const ADMIN_PLAN_OPTIONS = [
  { value: "hobby", label: "Hobby" },
  { value: "pro", label: "Pro" },
  { value: "premium", label: "Premium" },
  { value: "enterprise", label: "Enterprise" },
] as const;

function UpgradeMyPlanSheet({
  open,
  onOpenChange,
  currentPlan,
  userId,
  token,
  onChanged,
}: UpgradeMyPlanSheetProps) {
  const [selectedPlan, setSelectedPlan] = React.useState<string>(currentPlan);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const authHeader = React.useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  React.useEffect(() => {
    if (open) {
      setSelectedPlan(currentPlan || "hobby");
      setError(null);
      setSaved(false);
    }
  }, [open, currentPlan]);

  const PLAN_ORDER: Record<string, number> = {
    user: 0,
    hobby: 1,
    pro: 2,
    premium: 3,
    enterprise: 4,
  };
  const isDowngrade =
    (PLAN_ORDER[selectedPlan] ?? 0) < (PLAN_ORDER[currentPlan] ?? 0);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${API}/api/v1/users/${userId}`, {
        method: "PUT",
        headers: authHeader,
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to update plan");
      setSaved(true);
      onChanged?.();
      setTimeout(() => {
        setSaved(false);
        onOpenChange(false);
      }, 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[380px] sm:w-[420px]">
        <SheetHeader className="pb-4">
          <SheetTitle>Change My Plan</SheetTitle>
          <SheetDescription>
            Upgrade or downgrade your account subscription plan.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 mt-4">
          <div className="rounded-lg border p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Current plan
              </span>
              <Badge
                variant="outline"
                className={PLAN_COLOURS[currentPlan] ?? ""}
              >
                {ADMIN_PLAN_OPTIONS.find((p) => p.value === currentPlan)
                  ?.label ?? currentPlan}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {ADMIN_PLAN_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {isDowngrade && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 p-2 dark:bg-yellow-900/20 dark:border-yellow-800">
                <p className="text-xs text-yellow-800 dark:text-yellow-300">
                  Downgrading may fail if your current usage exceeds the new
                  plan&apos;s limits.
                </p>
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || selectedPlan === currentPlan}
            >
              {saving ? (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={14}
                  className="animate-spin mr-1"
                />
              ) : saved ? (
                <HugeiconsIcon
                  icon={CheckmarkCircle01Icon}
                  size={14}
                  className="text-green-600 mr-1"
                />
              ) : null}
              {saved ? "Saved!" : "Save Changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Create Organization Sheet ────────────────────────────────────────────────

interface CreateOrgSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onCreated?: () => void;
}

function CreateOrgSheet({
  open,
  onOpenChange,
  token,
  onCreated,
}: CreateOrgSheetProps) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setDescription("");
      setSlugEdited(false);
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (!slugEdited) setSlug(toSlug(name));
  }, [name, slugEdited]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/organizations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to create organization");
      setSuccess(true);
      onCreated?.();
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create New Organization</SheetTitle>
          <SheetDescription>
            Set up a new organization on the platform.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-name">Name *</Label>
            <Input
              id="co-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Zc8"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-slug">Slug *</Label>
            <Input
              id="co-slug"
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              placeholder="zc8"
            />
            <p className="text-xs text-muted-foreground">
              URL-friendly identifier — auto-generated from name
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="co-desc">Description</Label>
            <Input
              id="co-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />{" "}
              Organization created successfully!
            </p>
          )}
          <Button
            type="submit"
            disabled={submitting || !name || !slug}
            className="mt-2"
          >
            {submitting && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="mr-2 animate-spin"
              />
            )}
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-2" />
            Create Organization
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Create Team Sheet ────────────────────────────────────────────────────────

interface CreateTeamSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  isSuperAdmin: boolean;
  orgs: Org[];
  allTeams: Team[];
  planConfigs: PlanConfig[];
  defaultOrgId?: number | null;
  onCreated?: () => void;
}

function CreateTeamSheet({
  open,
  onOpenChange,
  token,
  isSuperAdmin,
  orgs,
  allTeams,
  planConfigs,
  defaultOrgId,
  onCreated,
}: CreateTeamSheetProps) {
  const [selectedOrgId, setSelectedOrgId] = React.useState<string>("");
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setDescription("");
      setSlugEdited(false);
      setError(null);
      setSuccess(false);
      setSelectedOrgId(defaultOrgId ? String(defaultOrgId) : "");
    } else {
      setSelectedOrgId(defaultOrgId ? String(defaultOrgId) : "");
    }
  }, [open, defaultOrgId]);

  React.useEffect(() => {
    if (!slugEdited) setSlug(toSlug(name));
  }, [name, slugEdited]);

  const effectiveOrgId = isSuperAdmin
    ? selectedOrgId
      ? Number(selectedOrgId)
      : null
    : defaultOrgId;

  const orgForDisplay = orgs.find((o) => o.id === effectiveOrgId);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveOrgId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/orgs/${effectiveOrgId}/teams`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          slug,
          description: description || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to create team");
      setSuccess(true);
      onCreated?.();
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create New Team</SheetTitle>
          <SheetDescription>Add a team to an organization.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-4">
          {isSuperAdmin ? (
            <div className="flex flex-col gap-1.5">
              <Label>Organization *</Label>
              <Select
                value={selectedOrgId}
                onValueChange={setSelectedOrgId}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select organization…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {orgs.map((org) => (
                      <SelectItem key={org.id} value={String(org.id)}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ) : (
            orgForDisplay && (
              <div className="rounded-md border p-3 text-sm">
                Organization:{" "}
                <span className="font-medium">{orgForDisplay.name}</span>
              </div>
            )
          )}
          {/* Name/Slug/Description fields */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-name">Name *</Label>
            <Input
              id="ct-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Engineering"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-slug">Slug *</Label>
            <Input
              id="ct-slug"
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              placeholder="engineering"
            />
            <p className="text-xs text-muted-foreground">
              URL-friendly identifier — auto-generated from name
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-desc">Description</Label>
            <Input
              id="ct-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} /> Team
              created successfully!
            </p>
          )}
          <Button
            type="submit"
            disabled={submitting || !name || !slug || !effectiveOrgId}
            className="mt-2"
          >
            {submitting && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="mr-2 animate-spin"
              />
            )}
            <HugeiconsIcon icon={Add01Icon} size={14} className="mr-2" />
            Create Team
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Change Member Role Sheet ─────────────────────────────────────────────────

interface ChangeMemberRoleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: OrgMember | null;
  orgId: number;
  roles: Role[];
  token: string;
  onChanged?: () => void;
}

function ChangeMemberRoleSheet({
  open,
  onOpenChange,
  member,
  orgId,
  roles: orgRoles,
  token,
  onChanged,
}: ChangeMemberRoleSheetProps) {
  const [roleId, setRoleId] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (member) setRoleId(String(member.role_id));
    if (!open) setError(null);
  }, [member, open]);

  const orgRoleList = orgRoles.filter((r) => r.scope === "organization");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/organizations/${orgId}/members/${member.id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role_id: Number(roleId) }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to update role");
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!member) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[360px] sm:w-[420px]">
        <SheetHeader>
          <SheetTitle>Change Role</SheetTitle>
          <SheetDescription>
            Update the organization role for {member.email}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Role</Label>
            <Select value={roleId} onValueChange={setRoleId} required>
              <SelectTrigger>
                <SelectValue placeholder="Select role…" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {orgRoleList.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="mr-2 animate-spin"
              />
            )}
            Update Role
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── ManageOrgSheet ──────────────────────────────────────────────────────────

interface ManageOrgSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  org: Org | null;
  token: string;
  allOrgs: Org[];
  allUsers: PlatformUser[];
  roles: Role[];
  isSuperAdmin: boolean;
  onUpdated: () => void;
}

function ManageOrgSheet({
  open,
  onOpenChange,
  org,
  token,
  allOrgs: _allOrgs,
  allUsers,
  roles,
  isSuperAdmin,
  onUpdated,
}: ManageOrgSheetProps) {
  type OrgMemberRow = {
    id: number;
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    roleName: string;
    invitationStatus: string;
  };

  const [members, setMembers] = React.useState<OrgMemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [subTeams, setSubTeams] = React.useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = React.useState(false);

  // Edit fields
  const [editName, setEditName] = React.useState("");
  const [editStatus, setEditStatus] = React.useState("active");
  const [editOwnerId, setEditOwnerId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Add member
  const [showAddMemberForm, setShowAddMemberForm] = React.useState(false);
  const [addMemberId, setAddMemberId] = React.useState("");
  const [addMemberRoleId, setAddMemberRoleId] = React.useState("");
  const [addingMember, setAddingMember] = React.useState(false);
  const [addMemberError, setAddMemberError] = React.useState<string | null>(
    null,
  );

  const authHeader = React.useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  React.useEffect(() => {
    if (!open || !org) return;
    setEditName(org.name);
    setEditStatus(org.status ?? "active");
    setEditOwnerId("");
    setSaveError(null);

    setLoadingMembers(true);
    fetch(`${API}/api/v1/organizations/${org.id}/members`, {
      headers: authHeader,
    })
      .then((r) => r.json())
      .then((j) => setMembers(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingMembers(false));

    setLoadingTeams(true);
    fetch(`${API}/api/v1/orgs/${org.id}/teams`, { headers: authHeader })
      .then((r) => r.json())
      .then((j) => setSubTeams(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingTeams(false));
  }, [open, org, authHeader]);

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        name: editName,
        status: editStatus,
      };
      if (editOwnerId) body.owner_id = editOwnerId;
      const res = await fetch(`${API}/api/v1/organizations/${org.id}`, {
        method: "PUT",
        headers: authHeader,
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to save");
      onUpdated();
      onOpenChange(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddOrgMember(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !addMemberId || !addMemberRoleId) return;
    setAddingMember(true);
    setAddMemberError(null);
    try {
      const res = await fetch(`${API}/api/v1/organizations/${org.id}/members`, {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({
          user_id: addMemberId,
          role_id: Number(addMemberRoleId),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to add member");
      setAddMemberId("");
      setAddMemberRoleId("");
      setShowAddMemberForm(false);
      // Refresh members list
      const r2 = await fetch(`${API}/api/v1/organizations/${org.id}/members`, {
        headers: authHeader,
      });
      const j2 = await r2.json();
      setMembers(j2.data ?? []);
      onUpdated();
    } catch (err) {
      setAddMemberError((err as Error).message);
    } finally {
      setAddingMember(false);
    }
  }

  if (!org) return null;

  const ownerMembers = members.filter((m) => m.roleName === "Owner");
  const orgRoles = roles.filter((r) => r.scope === "organization");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[460px] sm:w-[560px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Building04Icon} size={16} />
            {org.name}
          </SheetTitle>
          <SheetDescription>
            Manage organization settings, ownership, teams, and members.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-6">
          {/* ── Basic Info ── */}
          <section>
            <h3 className="text-sm font-semibold mb-3">Settings</h3>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isSuperAdmin && (
                <div className="flex flex-col gap-1.5">
                  <Label>Reassign owner (by user ID)</Label>
                  <Input
                    placeholder="User UUID…"
                    value={editOwnerId}
                    onChange={(e) => setEditOwnerId(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Current owner: {org.owner_email ?? "—"}
                  </p>
                </div>
              )}
              {saveError && (
                <p className="text-sm text-destructive">{saveError}</p>
              )}
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={13}
                    className="mr-2 animate-spin"
                  />
                )}
                Save Changes
              </Button>
            </div>
          </section>

          {/* ── Ownership ── */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Owners</h3>
            {loadingMembers ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : ownerMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No owners assigned.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {ownerMembers.map((m) => (
                  <li key={m.id} className="py-1.5 flex items-center gap-2">
                    <span className="font-medium">{m.email}</span>
                    <Badge variant="outline" className="text-xs">
                      Owner
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Teams ── */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Teams</h3>
            {loadingTeams ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : subTeams.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No teams in this organization.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {subTeams.map((t) => (
                  <li key={t.id} className="py-1.5 flex items-center gap-2">
                    <span>{t.name}</span>
                    {t.owner_email && (
                      <span className="text-xs text-muted-foreground">
                        ({t.owner_email})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Members ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Members</h3>
              {!showAddMemberForm && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddMemberForm(true)}
                >
                  + Add Member
                </Button>
              )}
            </div>
            {showAddMemberForm && (
              <form
                onSubmit={handleAddOrgMember}
                className="flex flex-col gap-2 mb-3 p-3 border rounded-md bg-muted/30"
              >
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">User</Label>
                  <Select value={addMemberId} onValueChange={setAddMemberId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select user…" />
                    </SelectTrigger>
                    <SelectContent>
                      {allUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id} className="text-xs">
                          {u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Role</Label>
                  <Select
                    value={addMemberRoleId}
                    onValueChange={setAddMemberRoleId}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select role…" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgRoles.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={String(r.id)}
                          className="text-xs"
                        >
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {addMemberError && (
                  <p className="text-xs text-destructive">{addMemberError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={addingMember || !addMemberId || !addMemberRoleId}
                  >
                    {addingMember ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowAddMemberForm(false);
                      setAddMemberError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {loadingMembers ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : members.length === 0 ? (
              <p className="text-xs text-muted-foreground">No members.</p>
            ) : (
              <ul className="divide-y text-sm">
                {members.map((m) => (
                  <li key={m.id} className="py-1.5 flex items-center gap-2">
                    <span className="flex-1">{m.email}</span>
                    <Badge variant="outline" className="text-xs">
                      {m.roleName}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── ManageTeamSheet ─────────────────────────────────────────────────────────

interface ManageTeamSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  team: Team | null;
  token: string;
  allTeams: Team[];
  allUsers: PlatformUser[];
  roles: Role[];
  isSuperAdmin: boolean;
  onUpdated: () => void;
}

function ManageTeamSheet({
  open,
  onOpenChange,
  team,
  token,
  allTeams,
  allUsers,
  roles,
  isSuperAdmin,
  onUpdated,
}: ManageTeamSheetProps) {
  type TeamMemberRow = {
    id: number;
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    roleName: string;
    invitationStatus: string;
  };

  const [members, setMembers] = React.useState<TeamMemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editStatus, setEditStatus] = React.useState("active");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Add member
  const [showAddMemberForm, setShowAddMemberForm] = React.useState(false);
  const [addMemberId, setAddMemberId] = React.useState("");
  const [addMemberRoleId, setAddMemberRoleId] = React.useState("");
  const [addingMember, setAddingMember] = React.useState(false);
  const [addMemberError, setAddMemberError] = React.useState<string | null>(
    null,
  );

  const authHeader = React.useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  React.useEffect(() => {
    if (!open || !team) return;
    setEditName(team.name);
    setEditStatus(team.status ?? "active");
    setSaveError(null);
    if (!team.organization_id) return;

    setLoadingMembers(true);
    fetch(
      `${API}/api/v1/orgs/${team.organization_id}/teams/${team.id}/members`,
      { headers: authHeader },
    )
      .then((r) => r.json())
      .then((j) => setMembers(j.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, [open, team, authHeader]);

  async function handleSave() {
    if (!team?.organization_id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/orgs/${team.organization_id}/teams/${team.id}`,
        {
          method: "PUT",
          headers: authHeader,
          body: JSON.stringify({ name: editName, status: editStatus }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to save");
      onUpdated();
      onOpenChange(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!team) return null;

  const ownerMembers = members.filter((m) => m.roleName === "TeamOwner");
  const regularMembers = members.filter((m) => m.roleName !== "TeamOwner");
  const teamRoles = roles.filter((r) => r.scope === "team");

  async function handleAddTeamMember(e: React.FormEvent) {
    e.preventDefault();
    if (!team?.organization_id || !addMemberId || !addMemberRoleId) return;
    setAddingMember(true);
    setAddMemberError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/orgs/${team.organization_id}/teams/${team.id}/members`,
        {
          method: "POST",
          headers: authHeader,
          body: JSON.stringify({
            user_id: addMemberId,
            role_id: Number(addMemberRoleId),
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.success)
        throw new Error(json.error || "Failed to add member");
      setAddMemberId("");
      setAddMemberRoleId("");
      setShowAddMemberForm(false);
      // Refresh members list
      const r2 = await fetch(
        `${API}/api/v1/orgs/${team.organization_id}/teams/${team.id}/members`,
        { headers: authHeader },
      );
      const j2 = await r2.json();
      setMembers(
        (j2.data ?? []).map((m: Record<string, unknown>) => ({
          id: m.id,
          userId: m.user_id,
          email: m.email,
          firstName: m.first_name ?? null,
          lastName: m.last_name ?? null,
          roleName: m.role_name,
          invitationStatus: m.invitation_status,
        })),
      );
      onUpdated();
    } catch (err) {
      setAddMemberError((err as Error).message);
    } finally {
      setAddingMember(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[460px] sm:w-[560px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={UserGroupIcon} size={16} />
            {team.name}
          </SheetTitle>
          <SheetDescription>
            {team.organization_name && (
              <span>Organization: {team.organization_name}</span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-6">
          {/* ── Settings ── */}
          <section>
            <h3 className="text-sm font-semibold mb-3">Settings</h3>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {saveError && (
                <p className="text-sm text-destructive">{saveError}</p>
              )}
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving && (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={13}
                    className="mr-2 animate-spin"
                  />
                )}
                Save Changes
              </Button>
            </div>
          </section>

          {/* ── Ownership ── */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Owners</h3>
            {loadingMembers ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : ownerMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No owners assigned.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {ownerMembers.map((m) => (
                  <li key={m.id} className="py-1.5 flex items-center gap-2">
                    <span className="flex-1">{m.email}</span>
                    <Badge variant="outline" className="text-xs">
                      TeamOwner
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Members ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Members</h3>
              {!showAddMemberForm && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddMemberForm(true)}
                >
                  + Add Member
                </Button>
              )}
            </div>
            {showAddMemberForm && (
              <form
                onSubmit={handleAddTeamMember}
                className="flex flex-col gap-2 mb-3 p-3 border rounded-md bg-muted/30"
              >
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">User</Label>
                  <Select value={addMemberId} onValueChange={setAddMemberId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select user…" />
                    </SelectTrigger>
                    <SelectContent>
                      {allUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id} className="text-xs">
                          {u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Role</Label>
                  <Select
                    value={addMemberRoleId}
                    onValueChange={setAddMemberRoleId}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select role…" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamRoles.map((r) => (
                        <SelectItem
                          key={r.id}
                          value={String(r.id)}
                          className="text-xs"
                        >
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {addMemberError && (
                  <p className="text-xs text-destructive">{addMemberError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={addingMember || !addMemberId || !addMemberRoleId}
                  >
                    {addingMember ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowAddMemberForm(false);
                      setAddMemberError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {loadingMembers ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : regularMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No members.</p>
            ) : (
              <ul className="divide-y text-sm">
                {regularMembers.map((m) => (
                  <li key={m.id} className="py-1.5 flex items-center gap-2">
                    <span className="flex-1">{m.email}</span>
                    <Badge variant="outline" className="text-xs">
                      {m.roleName}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

const VIEW_AS_STORAGE_KEY = "viewAs_userId";
const VIEW_AS_ORG_STORAGE_KEY = "viewAs_orgId";

export function UsersManagementTable() {
  const { session, isSuperAdmin, canAdmin, loading: authLoading } = useAuth();
  const token = session?.token ?? "";

  // Data state
  const [platformUsers, setPlatformUsers] = React.useState<PlatformUser[]>([]);
  const [orgMembers, setOrgMembers] = React.useState<OrgMember[]>([]);
  const [orgs, setOrgs] = React.useState<Org[]>([]);
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [roles, setRoles] = React.useState<Role[]>([]);
  const [planConfigs, setPlanConfigs] = React.useState<PlanConfig[]>([]);

  // Loading
  const [loadingUsers, setLoadingUsers] = React.useState(false);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [loadingOrgs, setLoadingOrgs] = React.useState(false);
  const [loadingTeams, setLoadingTeams] = React.useState(false);

  // Filters
  const [orgFilter, setOrgFilter] = React.useState<string>("all");

  // Sheet state
  const [detailUser, setDetailUser] = React.useState<PlatformUser | null>(null);
  const [showDetail, setShowDetail] = React.useState(false);
  const [showInvite, setShowInvite] = React.useState(false);
  const [showCreateUser, setShowCreateUser] = React.useState(false);
  const [showCreateOrg, setShowCreateOrg] = React.useState(false);
  const [showCreateTeam, setShowCreateTeam] = React.useState(false);
  const [manageAccessUser, setManageAccessUser] =
    React.useState<PlatformUser | null>(null);
  const [showManageAccess, setShowManageAccess] = React.useState(false);
  const [setPlanUser, setSetPlanUser] = React.useState<PlatformUser | null>(
    null,
  );
  const [showSetPlan, setShowSetPlan] = React.useState(false);
  const [showPlanConfig, setShowPlanConfig] = React.useState(false);
  const [changeRoleMember, setChangeRoleMember] =
    React.useState<OrgMember | null>(null);
  const [showChangeRole, setShowChangeRole] = React.useState(false);
  const [showUpgradePlan, setShowUpgradePlan] = React.useState(false);
  const [removeMemberError, setRemoveMemberError] = React.useState<
    string | null
  >(null);

  // Org management
  const [manageOrg, setManageOrg] = React.useState<Org | null>(null);
  const [showManageOrg, setShowManageOrg] = React.useState(false);
  const [deleteOrgTarget, setDeleteOrgTarget] = React.useState<Org | null>(
    null,
  );
  const [deleteOrgError, setDeleteOrgError] = React.useState<string | null>(
    null,
  );

  // Team management
  const [manageTeam, setManageTeam] = React.useState<Team | null>(null);
  const [showManageTeam, setShowManageTeam] = React.useState(false);
  const [deleteTeamTarget, setDeleteTeamTarget] = React.useState<Team | null>(
    null,
  );
  const [deleteTeamError, setDeleteTeamError] = React.useState<string | null>(
    null,
  );

  // User deletion
  const [deleteUserTarget, setDeleteUserTarget] =
    React.useState<PlatformUser | null>(null);
  const [deleteUserError, setDeleteUserError] = React.useState<string | null>(
    null,
  );

  // View-as-User (superAdmin only) — persisted to sessionStorage so refresh survives
  // Flag: true once the initial session-storage → state hydration has completed.
  // Prevents the sync effect from wiping the stored ID before hydration can read it.
  const didHydrateViewAs = React.useRef(false);
  const [viewAsUser, setViewAsUser] = React.useState<PlatformUser | null>(null);
  const [viewAsOrgId, setViewAsOrgId] = React.useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = sessionStorage.getItem(VIEW_AS_ORG_STORAGE_KEY);
    return v ? Number(v) : null;
  });
  const [viewAsOrgMembers, setViewAsOrgMembers] = React.useState<OrgMember[]>(
    [],
  );
  const [viewAsTeams, setViewAsTeams] = React.useState<Team[]>([]);
  const [loadingViewAs, setLoadingViewAs] = React.useState(false);

  const sessionOrgId = session?.organizationId ?? null;
  const sessionOrgName = session?.organizationName ?? null;
  const isAdmin =
    (session?.memberRole === "owner" || session?.memberRole === "admin") &&
    !isSuperAdmin;

  const authHeader = React.useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchPlatformUsers = React.useCallback(async () => {
    if (!token) return;
    setLoadingUsers(true);
    try {
      const res = await fetch(`${API}/api/v1/users`, { headers: authHeader });
      if (!res.ok) return;
      const json = await res.json();
      const parsed = z.array(platformUserSchema).safeParse(json.data);
      if (parsed.success) setPlatformUsers(parsed.data);
    } finally {
      setLoadingUsers(false);
    }
  }, [token, authHeader]);

  const fetchOrgMembers = React.useCallback(
    async (orgId: number) => {
      if (!token) return;
      setLoadingMembers(true);
      try {
        const res = await fetch(
          `${API}/api/v1/organizations/${orgId}/members`,
          { headers: authHeader },
        );
        if (!res.ok) return;
        const json = await res.json();
        const parsed = z.array(orgMemberSchema).safeParse(json.data);
        if (parsed.success) setOrgMembers(parsed.data);
      } finally {
        setLoadingMembers(false);
      }
    },
    [token, authHeader],
  );

  const fetchOrgs = React.useCallback(async () => {
    if (!token) return;
    setLoadingOrgs(true);
    try {
      const res = await fetch(`${API}/api/v1/organizations`, {
        headers: authHeader,
      });
      if (!res.ok) return;
      const json = await res.json();
      const parsed = z.array(orgSchema).safeParse(json.data);
      if (parsed.success) setOrgs(parsed.data);
    } finally {
      setLoadingOrgs(false);
    }
  }, [token, authHeader]);

  const fetchRoles = React.useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/v1/roles?scope=organization`, {
        headers: authHeader,
      });
      if (!res.ok) return;
      const json = await res.json();
      const parsed = z.array(roleSchema).safeParse(json.data);
      if (parsed.success) setRoles(parsed.data);
    } catch {
      /* ignore */
    }
  }, [token, authHeader]);

  const fetchTeams = React.useCallback(
    async (orgId?: number | null) => {
      if (!token) return;
      setLoadingTeams(true);
      try {
        const url = orgId
          ? `${API}/api/v1/orgs/${orgId}/teams`
          : `${API}/api/v1/teams`;
        const res = await fetch(url, { headers: authHeader });
        if (!res.ok) return;
        const json = await res.json();
        const parsed = z.array(teamSchema).safeParse(json.data);
        if (parsed.success) setTeams(parsed.data);
      } finally {
        setLoadingTeams(false);
      }
    },
    [token, authHeader],
  );

  const fetchPlanConfigs = React.useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/v1/plan-config`, {
        headers: authHeader,
      });
      if (!res.ok) return;
      const json = await res.json();
      const parsed = z.array(planConfigSchema).safeParse(json.data);
      if (parsed.success) setPlanConfigs(parsed.data);
    } catch {
      /* ignore — non-critical */
    }
  }, [token, authHeader]);

  // ── Initial load ──────────────────────────────────────────────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchers are stable callbacks
  React.useEffect(() => {
    if (!token) return;
    fetchRoles();
    fetchPlanConfigs();
    if (isSuperAdmin) {
      fetchPlatformUsers();
      fetchOrgs();
      fetchTeams();
    } else if (sessionOrgId) {
      fetchPlatformUsers();
      fetchOrgMembers(sessionOrgId);
      fetchTeams(sessionOrgId);
      fetchOrgs();
    }
  }, [token, isSuperAdmin, sessionOrgId]);

  // Hydrate viewAsUser from sessionStorage once platformUsers are loaded
  React.useEffect(() => {
    if (!isSuperAdmin || platformUsers.length === 0) return;
    // Mark hydration as complete so the sync effect below knows it may remove entries.
    didHydrateViewAs.current = true;
    const storedId = sessionStorage.getItem(VIEW_AS_STORAGE_KEY);
    if (storedId && !viewAsUser) {
      const found = platformUsers.find((u) => u.id === storedId);
      if (found) setViewAsUser(found);
      else sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
    }
  }, [isSuperAdmin, platformUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync viewAsUser changes to sessionStorage.
  // Only removes the entry after initial hydration is complete so that the stored
  // ID is not wiped when isSuperAdmin first transitions from false → true (while
  // viewAsUser is still null and platformUsers haven't loaded yet).
  React.useEffect(() => {
    if (!isSuperAdmin) return;
    if (viewAsUser) {
      sessionStorage.setItem(VIEW_AS_STORAGE_KEY, viewAsUser.id);
    } else if (didHydrateViewAs.current) {
      sessionStorage.removeItem(VIEW_AS_STORAGE_KEY);
    }
  }, [isSuperAdmin, viewAsUser]);

  // Sync viewAsOrgId changes to sessionStorage
  React.useEffect(() => {
    if (!isSuperAdmin) return;
    if (viewAsOrgId != null) {
      sessionStorage.setItem(VIEW_AS_ORG_STORAGE_KEY, String(viewAsOrgId));
    } else {
      sessionStorage.removeItem(VIEW_AS_ORG_STORAGE_KEY);
    }
  }, [isSuperAdmin, viewAsOrgId]);

  // Fetch view-as data when the superAdmin selects a user to view as
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable authHeader
  React.useEffect(() => {
    if (!viewAsUser || !token) {
      setViewAsOrgMembers([]);
      setViewAsTeams([]);
      return;
    }
    const orgId = viewAsOrgId ?? viewAsUser.organizations[0]?.id ?? null;
    if (orgId === null) return;
    setLoadingViewAs(true);
    Promise.all([
      fetch(`${API}/api/v1/organizations/${orgId}/members`, {
        headers: authHeader,
      }).then((r) => r.json()),
      fetch(`${API}/api/v1/orgs/${orgId}/teams`, {
        headers: authHeader,
      }).then((r) => r.json()),
    ])
      .then(([membJson, teamJson]) => {
        const membParsed = z.array(orgMemberSchema).safeParse(membJson.data);
        if (membParsed.success) {
          // Exclude superAdmin accounts to simulate what the regular user sees
          const superAdminIds = new Set(
            platformUsers
              .filter((u) => u.role === "superAdmin")
              .map((u) => u.id),
          );
          setViewAsOrgMembers(
            membParsed.data.filter((m) => !superAdminIds.has(m.user_id)),
          );
        }
        const teamParsed = z.array(teamSchema).safeParse(teamJson.data);
        if (teamParsed.success) setViewAsTeams(teamParsed.data);
      })
      .finally(() => setLoadingViewAs(false));
  }, [viewAsUser, viewAsOrgId, token]);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleRemoveMember(orgId: number, member: OrgMember) {
    setRemoveMemberError(null);
    // Block if the logged-in user is the last non-superAdmin owner
    if (
      member.user_id === session?.userId &&
      member.role_name.toLowerCase() === "owner"
    ) {
      const ownerCount = orgMembers.filter(
        (m) => m.role_name.toLowerCase() === "owner",
      ).length;
      if (ownerCount <= 1) {
        setRemoveMemberError(
          "You are the last owner of this organization. Transfer ownership to another member before leaving.",
        );
        return;
      }
    }
    // Block removal if the member belongs to any team within this org.
    // Cross-reference: get team IDs that belong to this org from the teams state,
    // then check if any of the user's teams (from platformUsers) are in that set.
    const userInPlatform = platformUsers.find((u) => u.id === member.user_id);
    const orgTeamIds = new Set(
      teams.filter((t) => t.organization_id === orgId).map((t) => t.id),
    );
    const userTeamsInOrg = (userInPlatform?.teams ?? []).filter((t) =>
      orgTeamIds.has(t.id),
    );
    if (userTeamsInOrg.length > 0) {
      setRemoveMemberError(
        `Cannot remove: this member belongs to ${userTeamsInOrg.length} team(s) in this organization. Remove from all teams first.`,
      );
      return;
    }
    const res = await fetch(
      `${API}/api/v1/organizations/${orgId}/members/${member.id}`,
      { method: "DELETE", headers: authHeader },
    );
    if (res.ok) {
      if (sessionOrgId) fetchOrgMembers(sessionOrgId);
    }
  }

  async function handleDeleteOrg(org: Org) {
    setDeleteOrgError(null);
    // Safety: block if org has any teams
    const orgTeams = teams.filter((t) => t.organization_id === org.id);
    if (orgTeams.length > 0) {
      setDeleteOrgError(
        `Cannot delete: this organization has ${orgTeams.length} team(s). Delete all teams first.`,
      );
      return;
    }
    // Safety: block if org has any members
    const membRes = await fetch(
      `${API}/api/v1/organizations/${org.id}/members`,
      {
        headers: authHeader,
      },
    );
    const membJson = await membRes.json();
    const memberCount: number = (membJson.data ?? []).length;
    if (memberCount > 0) {
      setDeleteOrgError(
        `Cannot delete: this organization has ${memberCount} member(s). Remove all members first.`,
      );
      return;
    }
    const res = await fetch(`${API}/api/v1/organizations/${org.id}`, {
      method: "DELETE",
      headers: authHeader,
    });
    if (res.ok) {
      setDeleteOrgTarget(null);
      fetchOrgs();
    } else {
      const j = await res.json().catch(() => ({}));
      setDeleteOrgError(j.error || "Failed to delete organization.");
    }
  }

  async function handleDeleteTeam(team: Team) {
    if (!team.organization_id) return;
    setDeleteTeamError(null);
    // Safety: block if team has any members
    const membRes = await fetch(
      `${API}/api/v1/orgs/${team.organization_id}/teams/${team.id}/members`,
      { headers: authHeader },
    );
    const membJson = await membRes.json();
    const memberCount: number = (membJson.data ?? []).length;
    if (memberCount > 0) {
      setDeleteTeamError(
        `Cannot delete: this team has ${memberCount} member(s). Remove all members first.`,
      );
      return;
    }
    const res = await fetch(
      `${API}/api/v1/orgs/${team.organization_id}/teams/${team.id}`,
      { method: "DELETE", headers: authHeader },
    );
    if (res.ok) {
      setDeleteTeamTarget(null);
      fetchTeams();
    } else {
      const j = await res.json().catch(() => ({}));
      setDeleteTeamError(j.error || "Failed to delete team.");
    }
  }

  // ── Filtered users ────────────────────────────────────────────────────────

  async function handleDeleteUser(user: PlatformUser) {
    setDeleteUserError(null);
    // Guard: block if user belongs to any organization
    if (user.organizations.length > 0) {
      setDeleteUserError(
        `Cannot delete: this user is a member of ${user.organizations.length} organization(s). Remove from all organizations first.`,
      );
      return;
    }
    const res = await fetch(`${API}/api/v1/users/${user.id}`, {
      method: "DELETE",
      headers: authHeader,
    });
    if (res.ok) {
      setDeleteUserTarget(null);
      fetchPlatformUsers();
    } else {
      const j = await res.json().catch(() => ({}));
      setDeleteUserError(j.error || "Failed to delete user.");
    }
  }

  const filteredPlatformUsers = React.useMemo(() => {
    if (orgFilter === "all") return platformUsers;
    const oid = Number(orgFilter);
    return platformUsers.filter((u) =>
      u.organizations.some((o) => o.id === oid),
    );
  }, [platformUsers, orgFilter]);

  // ── Column definitions ────────────────────────────────────────────────────

  const platformUserColumns: ColumnDef<PlatformUser>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
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
        accessorKey: "email",
        header: "User",
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={u.avatar_url ?? undefined} />
                <AvatarFallback className="text-xs">
                  {initials(u.first_name, u.last_name, u.email)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium text-sm">
                  {fullName(u.first_name, u.last_name, u.email)}
                </div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "role",
        header: "Platform Role",
        cell: ({ row }) => {
          const role = row.original.role ?? "user";
          const label =
            role === "superAdmin"
              ? "Super Admin"
              : role === "admin"
                ? "Admin"
                : "User";
          return (
            <Badge
              variant="outline"
              className={
                PLATFORM_ROLE_COLOURS[role] ?? "bg-gray-100 text-gray-700"
              }
            >
              {label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => {
          const plan = row.original.plan ?? "user";
          const label =
            PLAN_OPTIONS.find((p) => p.value === plan)?.label ?? plan;
          return (
            <Badge variant="outline" className={PLAN_COLOURS[plan] ?? ""}>
              {label}
            </Badge>
          );
        },
      },
      {
        id: "organizations",
        header: "Organizations",
        cell: ({ row }) => {
          const orgsForUser = row.original.organizations;
          if (!orgsForUser.length)
            return <span className="text-xs text-muted-foreground">None</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {orgsForUser.slice(0, 3).map((o) => (
                <Badge key={o.id} variant="secondary" className="text-xs">
                  {o.name}
                </Badge>
              ))}
              {orgsForUser.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{orgsForUser.length - 3}
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
          const t = row.original.teams;
          if (!t.length)
            return <span className="text-xs text-muted-foreground">None</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {t.slice(0, 2).map((tm) => (
                <Badge key={tm.id} variant="outline" className="text-xs">
                  {tm.name}
                </Badge>
              ))}
              {t.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{t.length - 2}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const u = row.original;
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
                    setManageAccessUser(u);
                    setShowManageAccess(true);
                  }}
                >
                  <HugeiconsIcon icon={Edit01Icon} size={14} className="mr-2" />{" "}
                  Manage Access
                </DropdownMenuItem>
                {isSuperAdmin && u.role !== "user" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setSetPlanUser(u);
                        setShowSetPlan(true);
                      }}
                    >
                      <HugeiconsIcon
                        icon={Settings01Icon}
                        size={14}
                        className="mr-2"
                      />{" "}
                      Set Plan
                    </DropdownMenuItem>
                    {u.role !== "superAdmin" && (
                      <DropdownMenuItem
                        onClick={() => {
                          setViewAsUser(u);
                          setViewAsOrgId(u.organizations[0]?.id ?? null);
                        }}
                      >
                        <HugeiconsIcon
                          icon={UserIcon}
                          size={14}
                          className="mr-2"
                        />{" "}
                        View as User
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {!isSuperAdmin &&
                  session?.memberRole === "owner" &&
                  u.id === session?.userId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setShowUpgradePlan(true)}
                      >
                        <HugeiconsIcon
                          icon={Settings01Icon}
                          size={14}
                          className="mr-2"
                        />{" "}
                        Change Plan
                      </DropdownMenuItem>
                    </>
                  )}
                {isSuperAdmin &&
                  u.role !== "superAdmin" &&
                  u.id !== session?.userId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteUserTarget(u)}
                      >
                        <HugeiconsIcon
                          icon={Delete02Icon}
                          size={14}
                          className="mr-2"
                        />{" "}
                        Delete User
                      </DropdownMenuItem>
                    </>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [isSuperAdmin, isAdmin, session],
  );

  const orgMemberColumns: ColumnDef<OrgMember>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
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
        accessorKey: "email",
        header: "Member",
        cell: ({ row }) => {
          const m = row.original;
          return (
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {initials(m.first_name, m.last_name, m.email)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium text-sm">
                  {fullName(m.first_name, m.last_name, m.email)}
                </div>
                <div className="text-xs text-muted-foreground">{m.email}</div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "role_name",
        header: "Role",
        cell: ({ row }) => {
          const role = row.original.role_name.toLowerCase();
          return (
            <Badge
              variant="outline"
              className={MEMBER_ROLE_COLOURS[role] ?? ""}
            >
              {row.original.role_name}
            </Badge>
          );
        },
      },
      {
        accessorKey: "invitation_status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.invitation_status.toLowerCase();
          return (
            <Badge variant="outline" className={STATUS_COLOURS[status] ?? ""}>
              {row.original.invitation_status}
            </Badge>
          );
        },
      },
      {
        accessorKey: "joined_at",
        header: "Joined",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.joined_at)}
          </span>
        ),
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
                    setChangeRoleMember(m);
                    setShowChangeRole(true);
                  }}
                >
                  <HugeiconsIcon
                    icon={LeftToRightListBulletIcon}
                    size={14}
                    className="mr-2"
                  />{" "}
                  Change Role
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() =>
                    sessionOrgId && handleRemoveMember(sessionOrgId, m)
                  }
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={14}
                    className="mr-2"
                  />{" "}
                  Remove from Org
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [sessionOrgId, orgMembers, session], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const orgColumns: ColumnDef<Org>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
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
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Building04Icon}
              size={14}
              className="text-muted-foreground"
            />
            <div>
              <div className="font-medium text-sm">{row.original.name}</div>
              <div className="text-xs text-muted-foreground">
                {row.original.slug}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const raw = row.original.status;
          if (!raw)
            return <span className="text-xs text-muted-foreground">—</span>;
          const status = raw.toLowerCase();
          return (
            <Badge variant="outline" className={STATUS_COLOURS[status] ?? ""}>
              {raw}
            </Badge>
          );
        },
      },
      {
        accessorKey: "owner_email",
        header: "Owner",
        cell: ({ row }) =>
          row.original.owner_email ? (
            <span className="text-sm">{row.original.owner_email}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const org = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setManageOrg(org);
                  setShowManageOrg(true);
                }}
              >
                <HugeiconsIcon icon={Edit01Icon} size={15} />
              </Button>
              {(isSuperAdmin || isAdmin) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteOrgTarget(org)}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={15} />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [isSuperAdmin, isAdmin],
  );

  const teamColumns: ColumnDef<Team>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() ? "indeterminate" : false)
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
        header: "Team",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={UserGroupIcon}
              size={14}
              className="text-muted-foreground"
            />
            <div>
              <div className="font-medium text-sm">{row.original.name}</div>
              <div className="text-xs text-muted-foreground">
                {row.original.slug}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "organization_name",
        header: "Organization",
        cell: ({ row }) =>
          row.original.organization_name ? (
            <span className="text-sm">{row.original.organization_name}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const raw = row.original.status;
          if (!raw)
            return <span className="text-xs text-muted-foreground">—</span>;
          const status = raw.toLowerCase();
          return (
            <Badge variant="outline" className={STATUS_COLOURS[status] ?? ""}>
              {raw}
            </Badge>
          );
        },
      },
      {
        accessorKey: "owner_email",
        header: "Owner",
        cell: ({ row }) =>
          row.original.owner_email ? (
            <span className="text-sm">{row.original.owner_email}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => {
          const team = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setManageTeam(team);
                  setShowManageTeam(true);
                }}
              >
                <HugeiconsIcon icon={Edit01Icon} size={15} />
              </Button>
              {(isSuperAdmin || isAdmin) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTeamTarget(team)}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={15} />
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [isSuperAdmin, isAdmin],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 lg:px-6">
      {/* Wait for auth to resolve so isSuperAdmin / isAdmin are correct */}
      {authLoading && (
        <div className="flex flex-col gap-3 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}
      {!authLoading && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Users &amp; Access
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                {isSuperAdmin
                  ? "Manage all platform users, organizations, and teams."
                  : `Manage members and teams in ${sessionOrgName ?? "your organization"}.`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <Button
                  variant="outline"
                  onClick={() => setShowCreateUser(true)}
                >
                  <HugeiconsIcon icon={Add01Icon} size={14} className="mr-2" />
                  New User
                </Button>
              )}
              <Button onClick={() => setShowInvite(true)}>
                <HugeiconsIcon
                  icon={UserGroupIcon}
                  size={14}
                  className="mr-2"
                />
                Add to Org
              </Button>
            </div>
          </div>

          {/* View-as-User Banner */}
          {isSuperAdmin && viewAsUser && (
            <div className="flex items-center gap-3 px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-950/20 dark:border-amber-800">
              <HugeiconsIcon
                icon={UserIcon}
                size={14}
                className="text-amber-700 dark:text-amber-400"
              />
              <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Viewing as:{" "}
                {fullName(
                  viewAsUser.first_name,
                  viewAsUser.last_name,
                  viewAsUser.email,
                )}
              </span>
              <span className="text-sm text-amber-700 dark:text-amber-300">
                ({viewAsUser.email})
              </span>
              {viewAsUser.organizations.length > 1 && (
                <Select
                  value={String(
                    viewAsOrgId ?? viewAsUser.organizations[0]?.id ?? "",
                  )}
                  onValueChange={(v) => setViewAsOrgId(Number(v))}
                >
                  <SelectTrigger className="w-[200px] h-7 text-xs ml-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {viewAsUser.organizations.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto border-amber-300 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/30"
                onClick={() => {
                  setViewAsUser(null);
                  setViewAsOrgId(null);
                }}
              >
                Exit View
              </Button>
            </div>
          )}

          {/* View-as-User: org-scoped simulation */}
          {isSuperAdmin &&
            viewAsUser &&
            (viewAsUser.role === "superAdmin" ? (
              /* Simulate superAdmin's perspective: Users / Organizations / Teams */
              <Tabs defaultValue="users">
                <TabsList className="mb-4">
                  <TabsTrigger value="users">
                    <HugeiconsIcon
                      icon={UserIcon}
                      size={14}
                      className="mr-1.5"
                    />
                    Users
                  </TabsTrigger>
                  <TabsTrigger value="organizations">
                    <HugeiconsIcon
                      icon={Building04Icon}
                      size={14}
                      className="mr-1.5"
                    />
                    Organizations
                  </TabsTrigger>
                  <TabsTrigger value="teams">
                    <HugeiconsIcon
                      icon={UserGroupIcon}
                      size={14}
                      className="mr-1.5"
                    />
                    Teams
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="users">
                  <DataTableShell
                    columns={orgMemberColumns}
                    data={viewAsOrgMembers}
                    filterKey="email"
                    filterPlaceholder="Search members…"
                    loading={loadingViewAs}
                  />
                </TabsContent>

                <TabsContent value="organizations">
                  <DataTableShell
                    columns={orgColumns}
                    data={orgs.filter((o) =>
                      viewAsUser.organizations.some((uo) => uo.id === o.id),
                    )}
                    filterKey="name"
                    filterPlaceholder="Search organizations…"
                    loading={loadingViewAs}
                  />
                </TabsContent>

                <TabsContent value="teams">
                  <DataTableShell
                    columns={teamColumns}
                    data={viewAsTeams}
                    filterKey="name"
                    filterPlaceholder="Search teams…"
                    loading={loadingViewAs}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              /* Simulate regular user's perspective: Members + Teams */
              <Tabs defaultValue="members">
                <TabsList className="mb-4">
                  <TabsTrigger value="members">
                    <HugeiconsIcon
                      icon={UserIcon}
                      size={14}
                      className="mr-1.5"
                    />
                    Members
                  </TabsTrigger>
                  <TabsTrigger value="teams">
                    <HugeiconsIcon
                      icon={UserGroupIcon}
                      size={14}
                      className="mr-1.5"
                    />
                    Teams
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="members">
                  <DataTableShell
                    columns={orgMemberColumns}
                    data={viewAsOrgMembers}
                    filterKey="email"
                    filterPlaceholder="Search members…"
                    loading={loadingViewAs}
                  />
                </TabsContent>

                <TabsContent value="teams">
                  <DataTableShell
                    columns={teamColumns}
                    data={viewAsTeams}
                    filterKey="name"
                    filterPlaceholder="Search teams…"
                    loading={loadingViewAs}
                  />
                </TabsContent>
              </Tabs>
            ))}

          {/* SuperAdmin view */}
          {isSuperAdmin && !viewAsUser ? (
            <Tabs defaultValue="users">
              <TabsList className="mb-4">
                <TabsTrigger value="users">
                  <HugeiconsIcon icon={UserIcon} size={14} className="mr-1.5" />
                  All Users
                </TabsTrigger>
                <TabsTrigger value="organizations">
                  <HugeiconsIcon
                    icon={Building04Icon}
                    size={14}
                    className="mr-1.5"
                  />
                  Organizations
                </TabsTrigger>
                <TabsTrigger value="teams">
                  <HugeiconsIcon
                    icon={UserGroupIcon}
                    size={14}
                    className="mr-1.5"
                  />
                  Teams
                </TabsTrigger>
                <TabsTrigger value="plan-config">
                  <HugeiconsIcon
                    icon={Settings01Icon}
                    size={14}
                    className="mr-1.5"
                  />
                  Plan Limits
                </TabsTrigger>
              </TabsList>

              <TabsContent value="users">
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <Select value={orgFilter} onValueChange={setOrgFilter}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Filter by organization…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Organizations</SelectItem>
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {orgFilter !== "all" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOrgFilter("all")}
                    >
                      Clear filter
                    </Button>
                  )}
                </div>
                <DataTableShell
                  columns={platformUserColumns}
                  data={filteredPlatformUsers}
                  filterKey="email"
                  filterPlaceholder="Search by email…"
                  loading={loadingUsers}
                />
              </TabsContent>

              <TabsContent value="organizations">
                <DataTableShell
                  columns={orgColumns}
                  data={orgs}
                  filterKey="name"
                  filterPlaceholder="Search organizations…"
                  loading={loadingOrgs}
                  headerRight={
                    <Button size="sm" onClick={() => setShowCreateOrg(true)}>
                      <HugeiconsIcon
                        icon={Add01Icon}
                        size={14}
                        className="mr-2"
                      />
                      New Organization
                    </Button>
                  }
                />
              </TabsContent>

              <TabsContent value="teams">
                <DataTableShell
                  columns={teamColumns}
                  data={teams}
                  filterKey="name"
                  filterPlaceholder="Search teams…"
                  loading={loadingTeams}
                  headerRight={
                    <Button size="sm" onClick={() => setShowCreateTeam(true)}>
                      <HugeiconsIcon
                        icon={Add01Icon}
                        size={14}
                        className="mr-2"
                      />
                      New Team
                    </Button>
                  }
                />
              </TabsContent>

              <TabsContent value="plan-config">
                <PlanConfigTab
                  planConfigs={planConfigs}
                  token={token}
                  onSaved={fetchPlanConfigs}
                />
              </TabsContent>
            </Tabs>
          ) : !isSuperAdmin ? (
            /* Admin view */
            <Tabs defaultValue="users">
              <TabsList className="mb-4">
                <TabsTrigger value="users">
                  <HugeiconsIcon icon={UserIcon} size={14} className="mr-1.5" />
                  Users
                </TabsTrigger>
                <TabsTrigger value="organizations">
                  <HugeiconsIcon
                    icon={Building04Icon}
                    size={14}
                    className="mr-1.5"
                  />
                  Organizations
                </TabsTrigger>
                <TabsTrigger value="teams">
                  <HugeiconsIcon
                    icon={UserGroupIcon}
                    size={14}
                    className="mr-1.5"
                  />
                  Teams
                </TabsTrigger>
              </TabsList>

              <TabsContent value="users">
                {removeMemberError && (
                  <div className="mb-3 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-center justify-between">
                    <span>{removeMemberError}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setRemoveMemberError(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
                <DataTableShell
                  columns={platformUserColumns}
                  data={platformUsers}
                  filterKey="email"
                  filterPlaceholder="Search by email…"
                  loading={loadingUsers}
                />
              </TabsContent>

              <TabsContent value="organizations">
                <DataTableShell
                  columns={orgColumns}
                  data={orgs}
                  filterKey="name"
                  filterPlaceholder="Search organizations…"
                  loading={loadingOrgs}
                  headerRight={
                    <Button size="sm" onClick={() => setShowCreateOrg(true)}>
                      <HugeiconsIcon
                        icon={Add01Icon}
                        size={14}
                        className="mr-2"
                      />
                      New Organization
                    </Button>
                  }
                />
              </TabsContent>

              <TabsContent value="teams">
                <DataTableShell
                  columns={teamColumns}
                  data={teams}
                  filterKey="name"
                  filterPlaceholder="Search teams…"
                  loading={loadingTeams}
                  headerRight={
                    canAdmin() &&
                    (() => {
                      const orgPlan =
                        orgs.find((o) => o.id === sessionOrgId)?.plan ??
                        "hobby";
                      const pCfg = planConfigs.find((c) => c.plan === orgPlan);
                      const teamCount = teams.filter(
                        (t) => t.organization_id === sessionOrgId,
                      ).length;
                      const limitReached =
                        pCfg &&
                        pCfg.max_teams_per_org > 0 &&
                        teamCount >= pCfg.max_teams_per_org;
                      return (
                        <Button
                          size="sm"
                          onClick={() => setShowCreateTeam(true)}
                          disabled={!!limitReached}
                          title={
                            limitReached
                              ? `Team limit reached (${teamCount}/${pCfg?.max_teams_per_org})`
                              : undefined
                          }
                        >
                          <HugeiconsIcon
                            icon={Add01Icon}
                            size={14}
                            className="mr-2"
                          />
                          New Team
                        </Button>
                      );
                    })()
                  }
                />
              </TabsContent>
            </Tabs>
          ) : null}

          {/* Sheets */}
          <UserDetailSheet
            user={detailUser}
            open={showDetail}
            onOpenChange={setShowDetail}
            isSuperAdmin={isSuperAdmin}
            token={token}
            onChanged={() => {
              if (isSuperAdmin) fetchPlatformUsers();
              else if (sessionOrgId) fetchOrgMembers(sessionOrgId);
            }}
          />

          <InviteMemberSheet
            open={showInvite}
            onOpenChange={setShowInvite}
            isSuperAdmin={isSuperAdmin}
            token={token}
            orgId={sessionOrgId}
            orgName={sessionOrgName}
            orgs={orgs}
            roles={roles}
            allUsers={platformUsers}
            onInvited={() => {
              if (isSuperAdmin) fetchPlatformUsers();
              else if (sessionOrgId) fetchOrgMembers(sessionOrgId);
            }}
          />

          {isSuperAdmin && (
            <CreateUserSheet
              open={showCreateUser}
              onOpenChange={setShowCreateUser}
              token={token}
              onCreated={fetchPlatformUsers}
            />
          )}

          {(isSuperAdmin || isAdmin) && (
            <CreateOrgSheet
              open={showCreateOrg}
              onOpenChange={setShowCreateOrg}
              token={token}
              onCreated={fetchOrgs}
            />
          )}

          <CreateTeamSheet
            open={showCreateTeam}
            onOpenChange={setShowCreateTeam}
            token={token}
            isSuperAdmin={isSuperAdmin}
            orgs={orgs}
            allTeams={teams}
            planConfigs={planConfigs}
            defaultOrgId={isSuperAdmin ? null : sessionOrgId}
            onCreated={() => {
              if (isSuperAdmin) fetchTeams();
              else if (sessionOrgId) fetchTeams(sessionOrgId);
            }}
          />

          <ManageUserAccessSheet
            user={manageAccessUser}
            open={showManageAccess}
            onOpenChange={setShowManageAccess}
            isSuperAdmin={isSuperAdmin}
            token={token}
            orgs={orgs}
            allTeams={teams}
            roles={roles}
            onChanged={() => {
              if (isSuperAdmin) fetchPlatformUsers();
              else if (sessionOrgId) fetchOrgMembers(sessionOrgId);
            }}
          />

          {isSuperAdmin && (
            <SetUserPlanSheet
              user={setPlanUser}
              open={showSetPlan}
              onOpenChange={setShowSetPlan}
              token={token}
              orgs={orgs}
              planConfigs={planConfigs}
              onChanged={fetchOrgs}
            />
          )}

          {!isSuperAdmin && session?.memberRole === "owner" && (
            <UpgradeMyPlanSheet
              open={showUpgradePlan}
              onOpenChange={setShowUpgradePlan}
              currentPlan={session?.userPlan ?? "hobby"}
              userId={session?.userId ?? ""}
              token={token}
              onChanged={() => {
                // Refresh user data after plan change — reload platform users
                fetchPlatformUsers();
              }}
            />
          )}

          {sessionOrgId !== null && (
            <ChangeMemberRoleSheet
              open={showChangeRole}
              onOpenChange={setShowChangeRole}
              member={changeRoleMember}
              orgId={sessionOrgId}
              roles={roles}
              token={token}
              onChanged={() => fetchOrgMembers(sessionOrgId)}
            />
          )}

          {/* Manage Org */}
          <ManageOrgSheet
            open={showManageOrg}
            onOpenChange={setShowManageOrg}
            org={manageOrg}
            token={token}
            allOrgs={orgs}
            allUsers={platformUsers}
            roles={roles}
            isSuperAdmin={isSuperAdmin}
            onUpdated={fetchOrgs}
          />

          {/* Manage Team */}
          <ManageTeamSheet
            open={showManageTeam}
            onOpenChange={setShowManageTeam}
            team={manageTeam}
            token={token}
            allTeams={teams}
            allUsers={platformUsers}
            roles={roles}
            isSuperAdmin={isSuperAdmin}
            onUpdated={() => {
              if (isSuperAdmin) fetchTeams();
              else if (sessionOrgId) fetchTeams(sessionOrgId);
            }}
          />

          {/* Delete Org confirmation */}
          {deleteOrgTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-background rounded-lg border shadow-lg p-6 w-[380px] flex flex-col gap-4">
                <h3 className="text-base font-semibold">
                  Delete organization?
                </h3>
                <p className="text-sm text-muted-foreground">
                  Permanently delete <strong>{deleteOrgTarget.name}</strong>?
                  This cannot be undone.
                </p>
                {deleteOrgError && (
                  <p className="text-sm text-destructive">{deleteOrgError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteOrgTarget(null);
                      setDeleteOrgError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteOrg(deleteOrgTarget)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Team confirmation */}
          {deleteTeamTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-background rounded-lg border shadow-lg p-6 w-[380px] flex flex-col gap-4">
                <h3 className="text-base font-semibold">Delete team?</h3>
                <p className="text-sm text-muted-foreground">
                  Permanently delete <strong>{deleteTeamTarget.name}</strong>?
                  This cannot be undone.
                </p>
                {deleteTeamError && (
                  <p className="text-sm text-destructive">{deleteTeamError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteTeamTarget(null);
                      setDeleteTeamError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteTeam(deleteTeamTarget)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Delete User confirmation */}
          {deleteUserTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-background rounded-lg border shadow-lg p-6 w-[380px] flex flex-col gap-4">
                <h3 className="text-base font-semibold">Delete user?</h3>
                <p className="text-sm text-muted-foreground">
                  Permanently delete{" "}
                  <strong>
                    {fullName(
                      deleteUserTarget.first_name,
                      deleteUserTarget.last_name,
                      deleteUserTarget.email,
                    )}
                  </strong>
                  ? This cannot be undone.
                </p>
                {deleteUserError && (
                  <p className="text-sm text-destructive">{deleteUserError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteUserTarget(null);
                      setDeleteUserError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteUser(deleteUserTarget)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
