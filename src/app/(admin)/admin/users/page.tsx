"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Search, MoreHorizontal, Shield, ShieldOff, Ban, CheckCircle, Trash2, KeyRound, UserPlus, Loader2, Mail, X } from "lucide-react";
import {
  getAllUsers,
  promoteToSiteAdmin,
  demoteFromSiteAdmin,
  banUser,
  unbanUser,
  adminDeleteUser,
  forceDisable2FA,
  adminInviteUser,
  adminGetPendingInvitations,
  adminRevokeInvitation,
} from "@/server/site-admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
type UserRow = any;

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", search, page],
    queryFn: () => getAllUsers({ page, pageSize: 20, search }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const promoteMutation = useMutation({
    mutationFn: promoteToSiteAdmin,
    onSuccess: () => {
      invalidate();
      toast.success("User promoted to site admin");
    },
    onError: (e) => toast.error(e.message),
  });

  const demoteMutation = useMutation({
    mutationFn: demoteFromSiteAdmin,
    onSuccess: () => {
      invalidate();
      toast.success("User demoted from site admin");
    },
    onError: (e) => toast.error(e.message),
  });

  const banMutation = useMutation({
    mutationFn: banUser,
    onSuccess: () => {
      invalidate();
      toast.success("User banned");
    },
    onError: (e) => toast.error(e.message),
  });

  const unbanMutation = useMutation({
    mutationFn: unbanUser,
    onSuccess: () => {
      invalidate();
      toast.success("User unbanned");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: adminDeleteUser,
    onSuccess: () => {
      invalidate();
      toast.success("User deleted");
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const disable2FAMutation = useMutation({
    mutationFn: forceDisable2FA,
    onSuccess: () => {
      invalidate();
      toast.success("2FA disabled for user");
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: pendingInvitations } = useQuery({
    queryKey: ["admin-pending-invitations"],
    queryFn: adminGetPendingInvitations,
  });

  const revokeMutation = useMutation({
    mutationFn: adminRevokeInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pending-invitations"] });
      toast.success("Invitation revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const inviteMutation = useMutation({
    mutationFn: adminInviteUser,
    onSuccess: (_data) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["admin-pending-invitations"] });
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteOpen(false);
      setInviteEmail("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="t-title text-fg">Users</h1>
          <p className="text-fg-3">
            Manage all users across the platform.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        </div>

        {/* Pending Invitations */}
        {((pendingInvitations || []) as any[]).length > 0 && (
          <div className="rounded-lg bg-bg-surface p-4 surface-ring">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Mail className="h-4 w-4 text-fg-3" />
              Pending Invitations
            </h3>
            <div className="space-y-2">
              {((pendingInvitations || []) as any[]).map((inv: any) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 rounded-md border border-dashed p-3"
                >
                  <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-inset">
                    <Mail className="h-3.5 w-3.5 text-fg-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-fg-3 truncate">
                      Invited to {inv.organization.name}
                      {inv.role ? ` as ${inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}` : ""}
                      {" - "}
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive"
                    onClick={() =>
                      setRevokeTarget({ id: inv.id, email: inv.email })
                    }
                  >
                    <X className="h-3.5 w-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">Revoke</span>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg bg-bg-surface p-0 surface-ring">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-bg-inset/50">
                  <th className="p-3 text-left font-medium">User</th>
                  <th className="p-3 text-left font-medium">Role</th>
                  <th className="p-3 text-left font-medium hidden lg:table-cell">Organizations</th>
                  <th className="p-3 text-center font-medium hidden sm:table-cell">2FA</th>
                  <th className="p-3 text-center font-medium hidden sm:table-cell">Status</th>
                  <th className="p-3 text-left font-medium hidden md:table-cell">Joined</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-fg-3">
                      Loading...
                    </td>
                  </tr>
                ) : data?.users?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-fg-3">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  data?.users?.map((user: UserRow) => (
                    <tr key={user.id} className="border-b hover:bg-bg-elevated/30">
                      <td className="p-3">
                        <div>
                          <div className="font-medium">{user.name}</div>
                          <div className="text-xs text-fg-3 truncate max-w-[200px]">
                            {user.email}
                          </div>
                          <div className="flex gap-1 mt-1 sm:hidden">
                            {user.banned && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Banned</Badge>}
                            {user.twoFactorEnabled && <Badge variant="outline" className="text-[10px] px-1.5 py-0">2FA</Badge>}
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        {user.role === "admin" ? (
                          <Badge className="bg-red-500/10 text-red-500 border-red-500/20">
                            Site Admin
                          </Badge>
                        ) : (
                          <Badge variant="secondary">User</Badge>
                        )}
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {user.members?.length === 0 ? (
                            <span className="text-xs text-fg-3">None</span>
                          ) : (
                            user.members?.map(
                              (
                                m: {
                                  role: string;
                                  organization: { id: string; name: string };
                                },
                                i: number,
                              ) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {m.organization.name} ({m.role.charAt(0).toUpperCase() + m.role.slice(1)})
                                </Badge>
                              ),
                            )
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center hidden sm:table-cell">
                        {user.twoFactorEnabled ? (
                          <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                            On
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Off</Badge>
                        )}
                      </td>
                      <td className="p-3 text-center hidden sm:table-cell">
                        {user.banned ? (
                          <Badge variant="destructive">Banned</Badge>
                        ) : (
                          <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                            Active
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-fg-3 hidden md:table-cell">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon" />
                            }
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              {user.role !== "admin" ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    promoteMutation.mutate(user.id)
                                  }
                                >
                                  <Shield className="mr-2 h-4 w-4" />
                                  Promote to Site Admin
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    demoteMutation.mutate(user.id)
                                  }
                                >
                                  <ShieldOff className="mr-2 h-4 w-4" />
                                  Demote from Site Admin
                                </DropdownMenuItem>
                              )}
                              {!user.banned ? (
                                <DropdownMenuItem
                                  onClick={() => banMutation.mutate(user.id)}
                                >
                                  <Ban className="mr-2 h-4 w-4" />
                                  Ban User
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    unbanMutation.mutate(user.id)
                                  }
                                >
                                  <CheckCircle className="mr-2 h-4 w-4" />
                                  Unban User
                                </DropdownMenuItem>
                              )}
                              {user.twoFactorEnabled && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    disable2FAMutation.mutate(user.id)
                                  }
                                >
                                  <KeyRound className="mr-2 h-4 w-4" />
                                  Force Disable 2FA
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeleteTarget(user)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete User
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg-3">
              Showing {data.users?.length} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Invite User Dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setInviteOpen(false);
            setInviteEmail("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Send an invitation email to a new user. They will be able to create
              an account even if registration is disabled.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              inviteMutation.mutate(inviteEmail);
            }}
          >
            <div className="space-y-2 py-4">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setInviteOpen(false);
                  setInviteEmail("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Send Invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{deleteTarget?.name}</strong> (
              {deleteTarget?.email}). This removes them from all organizations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DeleteDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={`Revoke invitation for ${revokeTarget?.email ?? ""}?`}
        description="The pending invitation link stops working immediately. You can send a fresh invite later."
        confirmLabel="Revoke invitation"
        onConfirm={() => {
          if (revokeTarget) {
            revokeMutation.mutate(revokeTarget.id);
            setRevokeTarget(null);
          }
        }}
        pending={revokeMutation.isPending}
      />
    </AdminShell>
  );
}
