"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionMatrix } from "./permission-matrix";
import { createCustomRole, updateCustomRole } from "@/server/custom-roles";
import {
  rolePermissions,
  ASSIGNABLE_BUILT_IN_ROLES,
  roleLabels,
  RESOURCES,
  type PermissionMap,
} from "@/lib/permissions";

interface RoleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRole?: {
    id: string;
    name: string;
    description: string | null;
    color: string | null;
    permissions: PermissionMap;
    ssoGroupClaim?: string | null;
  } | null;
}

const ROLE_COLORS = [
  { value: "blue", label: "Blue", classes: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  { value: "purple", label: "Purple", classes: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
  { value: "green", label: "Green", classes: "bg-green-500/10 text-green-500 border-green-500/20" },
  { value: "orange", label: "Orange", classes: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
  { value: "red", label: "Red", classes: "bg-red-500/10 text-red-500 border-red-500/20" },
  { value: "pink", label: "Pink", classes: "bg-pink-500/10 text-pink-500 border-pink-500/20" },
  { value: "teal", label: "Teal", classes: "bg-teal-500/10 text-teal-500 border-teal-500/20" },
  { value: "amber", label: "Amber", classes: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
];

function emptyPermissions(): PermissionMap {
  const p: PermissionMap = {};
  for (const r of RESOURCES) {
    p[r] = [];
  }
  return p;
}

export function RoleEditorDialog({
  open,
  onOpenChange,
  editingRole,
}: RoleEditorDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editingRole;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("blue");
  const [ssoGroupClaim, setSsoGroupClaim] = useState("");
  const [permissions, setPermissions] = useState<PermissionMap>(emptyPermissions());

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (editingRole) {
        setName(editingRole.name); // eslint-disable-line react-hooks/set-state-in-effect
        setDescription(editingRole.description || ""); // eslint-disable-line react-hooks/set-state-in-effect
        setColor(editingRole.color || "blue"); // eslint-disable-line react-hooks/set-state-in-effect
        setSsoGroupClaim(editingRole.ssoGroupClaim || ""); // eslint-disable-line react-hooks/set-state-in-effect
        setPermissions(editingRole.permissions); // eslint-disable-line react-hooks/set-state-in-effect
      } else {
        setName(""); // eslint-disable-line react-hooks/set-state-in-effect
        setDescription(""); // eslint-disable-line react-hooks/set-state-in-effect
        setColor("blue"); // eslint-disable-line react-hooks/set-state-in-effect
        setSsoGroupClaim(""); // eslint-disable-line react-hooks/set-state-in-effect
        setPermissions(emptyPermissions());
      }
    }
  }, [open, editingRole]);

  const createMut = useMutation({
    mutationFn: () =>
      createCustomRole({ name, description, color, ssoGroupClaim: ssoGroupClaim || undefined, permissions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
      toast.success("Role created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateCustomRole(editingRole!.id, { name, description, color, ssoGroupClaim: ssoGroupClaim || undefined, permissions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-roles"] });
      queryClient.invalidateQueries({ queryKey: ["current-role"] });
      toast.success("Role updated");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleStartFrom = (builtInRole: string) => {
    const template = rolePermissions[builtInRole];
    if (template) {
      // Deep copy
      const copy: PermissionMap = {};
      for (const r of RESOURCES) {
        copy[r] = [...(template[r] ?? [])];
      }
      setPermissions(copy);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[calc(100vw-4rem)] max-h-[calc(100vh-2rem)] h-[calc(100vh-4rem)] overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Custom Role" : "Create Custom Role"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Role Name</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stage Manager"
                maxLength={50}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-color">Badge Color</Label>
              <Select value={color} onValueChange={(v) => { if (v) setColor(v); }}>
                <SelectTrigger id="role-color">
                  <SelectValue>
                    {ROLE_COLORS.find((c) => c.value === color)?.label || color}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLE_COLORS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      <span className="flex items-center gap-2">
                        <span
                          className={`inline-block h-3 w-3 rounded-full ${c.classes.split(" ").find((cls) => cls.startsWith("bg-"))}`}
                        />
                        {c.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-desc">Description (optional)</Label>
            <Input
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this role is for..."
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-sso-group">SSO Group Claim (optional)</Label>
            <Input
              id="role-sso-group"
              value={ssoGroupClaim}
              onChange={(e) => setSsoGroupClaim(e.target.value)}
              placeholder="e.g. stage-managers"
              maxLength={200}
            />
            <p className="text-xs text-fg-3">
              When a user signs in via SSO and their identity provider returns this group name in the groups claim,
              they will automatically be assigned this role.
            </p>
          </div>

          {!isEditing && (
            <div className="space-y-2">
              <Label>Start from a built-in role template</Label>
              <div className="flex flex-wrap gap-2">
                {ASSIGNABLE_BUILT_IN_ROLES.map((role) => (
                  <Button
                    key={role}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartFrom(role)}
                  >
                    {roleLabels[role]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Permissions</Label>
            <PermissionMatrix
              permissions={permissions}
              onChange={setPermissions}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => (isEditing ? updateMut.mutate() : createMut.mutate())}
            disabled={isPending || !name.trim()}
          >
            {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ROLE_COLORS };
