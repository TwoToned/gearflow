"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { use, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AppImage } from "@/components/ui/app-image";
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
} from "@/components/ui/select";
import {
  ArrowLeft,
  Crown,
  Package,
  Boxes,
  UserPlus,
  Trash2,
} from "lucide-react";
import {
  adminGetOrganizationDetails,
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

function getRoleLabel(role: string) {
  return BUILT_IN_ROLES.find((r) => r.value === role)?.label ?? role;
}

export default function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = use(params);

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

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const { data: org, isLoading, refetch: refetchOrg } = useServerQuery({
    queryKey: ["admin-org-detail", orgId],
    queryFn: () => adminGetOrganizationDetails(orgId),
  });

  const addMutation = useServerMutation({
    mutationFn: () => adminAddMemberToOrg(orgId, addEmail, addRole),
    onSuccess: () => {
      refetchOrg();
      toast.success("Member added");
      setAddOpen(false);
      setAddEmail("");
      setAddRole("member");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = useServerMutation({
    mutationFn: (memberId: string) =>
      adminRemoveMemberFromOrg(orgId, memberId),
    onSuccess: () => {
      refetchOrg();
      toast.success("Member removed");
      setRemoveTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const roleChangeMutation = useServerMutation({
    mutationFn: ({
      memberId,
      newRole,
    }: {
      memberId: string;
      newRole: string;
    }) => adminChangeMemberRole(orgId, memberId, newRole),
    onSuccess: () => {
      refetchOrg();
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const transferMutation = useServerMutation({
    mutationFn: (newOwnerId: string) =>
      adminTransferOwnership(orgId, newOwnerId),
    onSuccess: () => {
      refetchOrg();
      toast.success("Ownership transferred");
      setTransferTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateOrgMutation = useServerMutation({
    mutationFn: (data: { name?: string; slug?: string }) =>
      adminUpdateOrganization(orgId, data),
    onSuccess: () => {
      refetchOrg();
      // The list page's ["admin-the-org"] is a different route — it remounts and
      // refetches on navigation, so its cross-route invalidation drops here.
      toast.success("Organization updated");
      setEditOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const members: any[] = org?.members ?? [];
  // Domain counts (assets/projects/kits) are Convex-native now; only the KEPT
  // auth relations remain countable via Prisma.
  const counts = org?._count ?? {
    members: 0,
    invitations: 0,
  };

  return (
    <AdminShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="shrink-0" asChild>
              <Link href="/admin/organizations">
                <ArrowLeft className="h-4 w-4" />
              </Link>
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
                variant="line"
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
            </div>
          )}
        </div>

        {/* Stats */}
        {org && (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="t-title t-data">{counts.members}</p>
                  <p className="text-xs text-fg-3">Members</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-bg-surface p-4 surface-ring">
              <div className="flex items-center gap-3">
                <Boxes className="h-5 w-5 text-fg-3" />
                <div>
                  <p className="t-title t-data">{counts.invitations}</p>
                  <p className="text-xs text-fg-3">Invitations</p>
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

                      return (
                        <tr
                          key={m.id}
                          className="border-b hover:bg-bg-elevated/30"
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {m.user.image ? (
                                <AppImage
                                  src={m.user.image}
                                  alt=""
                                  width={28}
                                  height={28}
                                  className="h-7 w-7 rounded-full shrink-0 object-cover"
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
                              <Badge status="neutral">Owner</Badge>
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
                                    <Badge status="neutral">
                                      {getRoleLabel(m.role)}
                                    </Badge>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSIGNABLE_BUILT_IN_ROLES.map((r) => (
                                    <SelectItem key={r.value} value={r.value}>
                                      {r.label}
                                    </SelectItem>
                                  ))}
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
                  <SelectValue>{ASSIGNABLE_BUILT_IN_ROLES.find((r) => r.value === addRole)?.label ?? addRole}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_BUILT_IN_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="line" onClick={() => setAddOpen(false)}>
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
            <Button variant="line" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
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
            <Button variant="line" onClick={() => setTransferTarget(null)}>
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
            <Button variant="line" onClick={() => setEditOpen(false)}>
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
