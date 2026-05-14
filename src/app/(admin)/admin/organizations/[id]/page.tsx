"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Crown,
  Package,
  Boxes,
  FolderKanban,
  BoxIcon,
  UserPlus,
  Trash2,
  Shield,
  Download,
} from "lucide-react";
import {
  adminGetOrganizationDetails,
  adminGetOrgCustomRoles,
  adminAddMemberToOrg,
  adminRemoveMemberFromOrg,
  adminChangeMemberRole,
  adminTransferOwnership,
  adminUpdateOrganization,
} from "@/server/site-admin";
import { Label } from "@/components/ui/label";
import { Pencil } from "lucide-react";

const BUILT_IN_ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "member", label: "Member" },
  { value: "warehouse", label: "Warehouse" },
  { value: "viewer", label: "Viewer" },
];

const ASSIGNABLE_BUILT_IN_ROLES = BUILT_IN_ROLES.filter(
  (r) => r.value !== "owner",
);

function getRoleLabel(
  role: string,
  customRoles: Array<{ id: string; name: string; color?: string | null }>,
) {
  if (role.startsWith("custom:")) {
    const id = role.slice("custom:".length);
    const cr = customRoles.find((r) => r.id === id);
    return cr?.name ?? "Custom Role";
  }
  return BUILT_IN_ROLES.find((r) => r.value === role)?.label ?? role;
}

function getRoleBadgeColor(
  role: string,
  customRoles: Array<{ id: string; color?: string | null }>,
) {
  if (role.startsWith("custom:")) {
    const id = role.slice("custom:".length);
    const cr = customRoles.find((r) => r.id === id);
    return cr?.color ?? undefined;
  }
  return undefined;
}

export default function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = use(params);
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("member");

  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [transferTarget, setTransferTarget] = useState<{
    memberId: string;
    userId: string;
    name: string;
  } | null>(null);

  const [exporting, setExporting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/org-export/${orgId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(body.error || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-export-${orgId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const { data: org, isLoading } = useQuery({
    queryKey: ["admin-org-detail", orgId],
    queryFn: () => adminGetOrganizationDetails(orgId),
  });

  const { data: customRoles = [] } = useQuery({
    queryKey: ["admin-org-custom-roles", orgId],
    queryFn: () => adminGetOrgCustomRoles(orgId),
  });

  const addMutation = useMutation({
    mutationFn: () => adminAddMemberToOrg(orgId, addEmail, addRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org-detail", orgId] });
      toast.success("Member added");
      setAddOpen(false);
      setAddEmail("");
      setAddRole("member");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      adminRemoveMemberFromOrg(orgId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org-detail", orgId] });
      toast.success("Member removed");
      setRemoveTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const roleChangeMutation = useMutation({
    mutationFn: ({
      memberId,
      newRole,
    }: {
      memberId: string;
      newRole: string;
    }) => adminChangeMemberRole(orgId, memberId, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org-detail", orgId] });
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const transferMutation = useMutation({
    mutationFn: (newOwnerId: string) =>
      adminTransferOwnership(orgId, newOwnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org-detail", orgId] });
      toast.success("Ownership transferred");
      setTransferTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateOrgMutation = useMutation({
    mutationFn: (data: { name?: string; slug?: string }) =>
      adminUpdateOrganization(orgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-org-detail", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin-the-org"] });
      toast.success("Organization updated");
      setEditOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const members: any[] = org?.members ?? [];
  const counts = org?._count ?? {
    assets: 0,
    bulkAssets: 0,
    projects: 0,
    kits: 0,
  };

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="shrink-0" render={<Link href="/admin/organizations" />}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl sm:t-title text-fg truncate">
                {isLoading ? "Loading..." : org?.name}
              </h1>
              {org && (
                <p className="text-fg-3 text-sm font-mono truncate">
                  {org.slug}
                </p>
              )}
            </div>
          </div>
          {org && (
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditName(org.name);
                  setEditSlug(org.slug);
                  setEditOpen(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                {exporting ? "Exporting..." : "Export"}
              </Button>
            </div>
          )}
        </div>

        {/* Stats */}
        {org && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="t-title t-data">{counts.assets}</p>
                  <p className="text-xs text-fg-3">Assets</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="flex items-center gap-3">
                <Boxes className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="t-title t-data">{counts.bulkAssets}</p>
                  <p className="text-xs text-fg-3">Bulk Assets</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="flex items-center gap-3">
                <FolderKanban className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="t-title t-data">{counts.projects}</p>
                  <p className="text-xs text-fg-3">Projects</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="flex items-center gap-3">
                <BoxIcon className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="t-title t-data">{counts.kits}</p>
                  <p className="text-xs text-fg-3">Kits</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Members */}
        <div className="rounded-lg bg-bg-surface surface-ring">
          <div className="flex flex-wrap items-center justify-between gap-2 p-5 sm:p-6 pb-0 sm:pb-0">
            <h3 className="t-heading">Members ({members.length})</h3>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>
          <div className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-bg-inset/50">
                    <th className="p-3 text-left font-medium">User</th>
                    <th className="p-3 text-left font-medium hidden md:table-cell">Email</th>
                    <th className="p-3 text-left font-medium">Role</th>
                    <th className="p-3 text-left font-medium hidden sm:table-cell">Joined</th>
                    <th className="p-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-fg-3"
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : members.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-fg-3"
                      >
                        No members.
                      </td>
                    </tr>
                  ) : (
                    members.map((m: any) => {
                      const isOwner = m.role === "owner";
                      const badgeColor = getRoleBadgeColor(
                        m.role,
                        customRoles,
                      );

                      return (
                        <tr
                          key={m.id}
                          className="border-b hover:bg-bg-elevated/30"
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {m.user.image ? (
                                <img
                                  src={m.user.image}
                                  alt=""
                                  className="h-7 w-7 rounded-full shrink-0"
                                />
                              ) : (
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-inset text-xs font-medium">
                                  {(m.user.name || "?")[0].toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium truncate">
                                    {m.user.name || "Unnamed"}
                                  </span>
                                  {isOwner && (
                                    <Crown className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
                                  )}
                                </div>
                                <div className="text-xs text-fg-3 truncate md:hidden">
                                  {m.user.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-fg-3 hidden md:table-cell">
                            {m.user.email}
                          </td>
                          <td className="p-3">
                            {isOwner ? (
                              <Badge variant="outline">Owner</Badge>
                            ) : (
                              <Select
                                value={m.role}
                                onValueChange={(newRole) =>
                                  roleChangeMutation.mutate({
                                    memberId: m.id,
                                    newRole,
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[160px]">
                                  <SelectValue>
                                    <Badge
                                      variant="secondary"
                                      style={
                                        badgeColor
                                          ? { backgroundColor: badgeColor, color: "#fff" }
                                          : undefined
                                      }
                                    >
                                      {getRoleLabel(m.role, customRoles)}
                                    </Badge>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSIGNABLE_BUILT_IN_ROLES.map((r) => (
                                    <SelectItem key={r.value} value={r.value}>
                                      {r.label}
                                    </SelectItem>
                                  ))}
                                  {customRoles.length > 0 && (
                                    <>
                                      <SelectSeparator />
                                      {customRoles.map((cr: any) => (
                                        <SelectItem
                                          key={cr.id}
                                          value={`custom:${cr.id}`}
                                        >
                                          <div className="flex items-center gap-2">
                                            {cr.color && (
                                              <span
                                                className="inline-block h-2.5 w-2.5 rounded-full"
                                                style={{
                                                  backgroundColor: cr.color,
                                                }}
                                              />
                                            )}
                                            {cr.name}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="p-3 text-fg-3 hidden sm:table-cell">
                            {new Date(m.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isOwner && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Transfer ownership"
                                    onClick={() =>
                                      setTransferTarget({
                                        memberId: m.id,
                                        userId: m.userId,
                                        name: m.user.name || m.user.email,
                                      })
                                    }
                                  >
                                    <Crown className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive"
                                    title="Remove member"
                                    onClick={() =>
                                      setRemoveTarget({
                                        id: m.id,
                                        name: m.user.name || m.user.email,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Custom Roles Info */}
        {customRoles.length > 0 && (
          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <h3 className="t-heading flex items-center gap-2 mb-4">
              <Shield className="h-4 w-4" />
              Custom Roles ({customRoles.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {customRoles.map((cr: any) => (
                <Badge
                  key={cr.id}
                  variant="secondary"
                  style={
                    cr.color
                      ? { backgroundColor: cr.color, color: "#fff" }
                      : undefined
                  }
                >
                  {cr.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Member Dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false);
            setAddEmail("");
            setAddRole("member");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member to Organization</DialogTitle>
            <DialogDescription>
              Add an existing user to this organization by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={addRole} onValueChange={(v) => { if (v) setAddRole(v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_BUILT_IN_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                  {customRoles.length > 0 && (
                    <>
                      <SelectSeparator />
                      {customRoles.map((cr: any) => (
                        <SelectItem key={cr.id} value={`custom:${cr.id}`}>
                          <div className="flex items-center gap-2">
                            {cr.color && (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: cr.color }}
                              />
                            )}
                            {cr.name}
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!addEmail.trim() || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Dialog */}
      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Remove <strong>{removeTarget?.name}</strong> from this
              organization? They will lose access to all org data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() =>
                removeTarget && removeMutation.mutate(removeTarget.id)
              }
            >
              {removeMutation.isPending ? "Removing..." : "Remove Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Dialog */}
      <Dialog
        open={!!transferTarget}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Ownership</DialogTitle>
            <DialogDescription>
              Transfer ownership of this organization to{" "}
              <strong>{transferTarget?.name}</strong>? The current owner will be
              demoted to admin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={transferMutation.isPending}
              onClick={() =>
                transferTarget &&
                transferMutation.mutate(transferTarget.userId)
              }
            >
              {transferMutation.isPending
                ? "Transferring..."
                : "Transfer Ownership"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Organization Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) setEditOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update the organization name and URL slug.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-org-name">Name</Label>
              <Input
                id="edit-org-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-org-slug">URL Slug</Label>
              <Input
                id="edit-org-slug"
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value)}
              />
              <p className="text-xs text-fg-3">
                Only lowercase letters, numbers, and hyphens. Used internally.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!editName.trim() || !editSlug.trim() || updateOrgMutation.isPending}
              onClick={() =>
                updateOrgMutation.mutate({
                  name: editName.trim(),
                  slug: editSlug.trim(),
                })
              }
            >
              {updateOrgMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
