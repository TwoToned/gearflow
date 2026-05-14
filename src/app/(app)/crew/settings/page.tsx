"use client";

import { useState } from "react";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  getCrewRoles,
  createCrewRole,
  updateCrewRole,
  deleteCrewRole,
  getCrewSkills,
  createCrewSkill,
  deleteCrewSkill,
} from "@/server/crew";
import {
  crewRoleSchema,
  crewSkillSchema,
  type CrewRoleFormValues,
  type CrewSkillFormValues,
} from "@/lib/validations/crew";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CrewSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();

  // ─── Roles ──────────────────────────────────────────────────────────────
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Record<string, unknown> | null>(null);
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteSkillTarget, setDeleteSkillTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ["crew-roles-all", orgId],
    queryFn: () => getCrewRoles(),
  });

  const deleteRoleMut = useMutation({
    mutationFn: (id: string) => deleteCrewRole(id),
    onSuccess: () => {
      toast.success("Role deleted");
      queryClient.invalidateQueries({ queryKey: ["crew-roles-all", orgId] });
      queryClient.invalidateQueries({ queryKey: ["crew-roles", orgId] });
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Skills ─────────────────────────────────────────────────────────────
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillCategory, setNewSkillCategory] = useState("");

  const { data: skills, isLoading: skillsLoading } = useQuery({
    queryKey: ["crew-skills-all", orgId],
    queryFn: () => getCrewSkills(),
  });

  const createSkillMut = useMutation({
    mutationFn: (data: CrewSkillFormValues) => createCrewSkill(data),
    onSuccess: () => {
      toast.success("Skill created");
      setNewSkillName("");
      setNewSkillCategory("");
      setSkillDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["crew-skills-all", orgId] });
      queryClient.invalidateQueries({ queryKey: ["crew-skill-options", orgId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteSkillMut = useMutation({
    mutationFn: (id: string) => deleteCrewSkill(id),
    onSuccess: () => {
      toast.success("Skill deleted");
      queryClient.invalidateQueries({ queryKey: ["crew-skills-all", orgId] });
      queryClient.invalidateQueries({ queryKey: ["crew-skill-options", orgId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <RequirePermission resource="crew" action="read">
      <PageMeta title="Crew Settings" />
      <div className="space-y-8">
        <div>
          <h1 className="t-title text-fg">Crew Settings</h1>
          <p className="text-fg-3">
            Manage crew roles, skills, and other crew configuration.
          </p>
        </div>

        {/* ─── Roles Section ──────────────────────────────────────────────── */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="t-heading text-fg">Crew Roles</h3>
              <p className="t-body text-fg-3 mt-1">
                Define roles that can be assigned to crew members and project
                assignments. Each role can have a default rate.
              </p>
            </div>
            <CanDo resource="crew" action="create">
              <Button
                size="sm"
                onClick={() => {
                  setEditingRole(null);
                  setRoleDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Role
              </Button>
            </CanDo>
          </div>
          {rolesLoading ? (
            <p className="text-sm text-fg-3 text-center py-4">
              Loading...
            </p>
          ) : !roles || roles.length === 0 ? (
            <p className="text-sm text-fg-3 text-center py-4">
              No roles defined yet. Create your first role to get started.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Department
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Default Rate
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Members
                    </TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    roles as {
                      id: string;
                      name: string;
                      department: string | null;
                      color: string | null;
                      defaultRate: number | null;
                      rateType: string | null;
                      description: string | null;
                      _count: { crewMembers: number };
                    }[]
                  ).map((role) => (
                    <TableRow key={role.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {role.color && (
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: role.color }}
                            />
                          )}
                          <div>
                            <span className="font-medium">{role.name}</span>
                            {role.description && (
                              <p className="text-xs text-fg-3">
                                {role.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-fg-3">
                        {role.department || "\u2014"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {role.defaultRate != null &&
                        Number(role.defaultRate) > 0 ? (
                          <span className="t-data">
                            ${Number(role.defaultRate).toFixed(2)}{" "}
                            <span className="text-fg-3 text-xs">
                              {crewRateTypeLabels[role.rateType || "DAILY"] ||
                                ""}
                            </span>
                          </span>
                        ) : (
                          <span className="text-fg-3">
                            {"\u2014"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary" className="text-xs">
                          <Users className="mr-1 h-3 w-3" />
                          {role._count.crewMembers}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <CanDo resource="crew" action="update">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingRole(role);
                                setRoleDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </CanDo>
                          <CanDo resource="crew" action="delete">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              disabled={role._count.crewMembers > 0}
                              onClick={() =>
                                setDeleteRoleTarget({ id: role.id, name: role.name })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </CanDo>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ─── Skills Section ─────────────────────────────────────────────── */}
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="t-heading text-fg">Crew Skills</h3>
              <p className="t-body text-fg-3 mt-1">
                Skills are tags that describe what a crew member can do. Use them
                to filter when searching for available crew.
              </p>
            </div>
            <CanDo resource="crew" action="create">
              <Button size="sm" onClick={() => setSkillDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Skill
              </Button>
            </CanDo>
          </div>
          {skillsLoading ? (
            <p className="text-sm text-fg-3 text-center py-4">
              Loading...
            </p>
          ) : !skills || skills.length === 0 ? (
            <p className="text-sm text-fg-3 text-center py-4">
              No skills defined yet. Create skills that crew members can be
              tagged with.
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Category
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Members
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    skills as {
                      id: string;
                      name: string;
                      category: string | null;
                      _count: { crewMembers: number };
                    }[]
                  ).map((skill) => (
                    <TableRow key={skill.id}>
                      <TableCell className="font-medium">
                        {skill.name}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-fg-3">
                        {skill.category || "\u2014"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary" className="text-xs">
                          <Users className="mr-1 h-3 w-3" />
                          {skill._count.crewMembers}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <CanDo resource="crew" action="delete">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            disabled={skill._count.crewMembers > 0}
                            onClick={() =>
                              setDeleteSkillTarget({ id: skill.id, name: skill.name })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </CanDo>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* ─── Role Dialog ────────────────────────────────────────────────── */}
      <RoleDialog
        key={editingRole ? (editingRole.id as string) : "new"}
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
        role={editingRole}
      />

      {/* ─── Skill Dialog ───────────────────────────────────────────────── */}
      <Dialog open={skillDialogOpen} onOpenChange={setSkillDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Skill</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newSkillName.trim()) {
                createSkillMut.mutate({
                  name: newSkillName.trim(),
                  category: newSkillCategory.trim() || undefined,
                });
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="e.g. GrandMA, Rigging, D&B"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input
                placeholder="e.g. Audio, Lighting, General"
                value={newSkillCategory}
                onChange={(e) => setNewSkillCategory(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSkillDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newSkillName.trim() || createSkillMut.isPending}
              >
                {createSkillMut.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Add Skill
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <DeleteDialog
        open={!!deleteRoleTarget}
        onOpenChange={(open) => !open && setDeleteRoleTarget(null)}
        title={`Delete role "${deleteRoleTarget?.name ?? ""}"?`}
        description="This permanently removes the crew role. Roles assigned to crew members must be unassigned first. This cannot be undone."
        confirmLabel="Delete role"
        onConfirm={() => {
          if (deleteRoleTarget) {
            deleteRoleMut.mutate(deleteRoleTarget.id);
            setDeleteRoleTarget(null);
          }
        }}
        pending={deleteRoleMut.isPending}
      />
      <DeleteDialog
        open={!!deleteSkillTarget}
        onOpenChange={(open) => !open && setDeleteSkillTarget(null)}
        title={`Delete skill "${deleteSkillTarget?.name ?? ""}"?`}
        description="This permanently removes the skill. Skills assigned to crew members must be unassigned first. This cannot be undone."
        confirmLabel="Delete skill"
        onConfirm={() => {
          if (deleteSkillTarget) {
            deleteSkillMut.mutate(deleteSkillTarget.id);
            setDeleteSkillTarget(null);
          }
        }}
        pending={deleteSkillMut.isPending}
      />
    </RequirePermission>
  );
}

// ─── Role Create/Edit Dialog ───────────────────────────────────────────────────

function RoleDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Record<string, unknown> | null;
}) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isEditing = !!role;

  const form = useForm<CrewRoleFormValues>({
    resolver: zodResolver(crewRoleSchema),
    defaultValues: role
      ? {
          name: role.name as string,
          description: (role.description as string) || "",
          department: (role.department as string) || "",
          color: (role.color as string) || "",
          defaultRate:
            role.defaultRate != null ? Number(role.defaultRate) : undefined,
          rateType: (role.rateType as CrewRoleFormValues["rateType"]) || "",
          isActive: true,
        }
      : {
          name: "",
          description: "",
          department: "",
          color: "",
          rateType: "",
          isActive: true,
        },
  });

  const createMut = useMutation({
    mutationFn: (data: CrewRoleFormValues) => createCrewRole(data),
    onSuccess: () => {
      toast.success("Role created");
      queryClient.invalidateQueries({ queryKey: ["crew-roles-all", orgId] });
      queryClient.invalidateQueries({ queryKey: ["crew-roles", orgId] });
      onOpenChange(false);
      form.reset();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (data: CrewRoleFormValues) =>
      updateCrewRole(role!.id as string, data),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["crew-roles-all", orgId] });
      queryClient.invalidateQueries({ queryKey: ["crew-roles", orgId] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = (data: CrewRoleFormValues) => {
    if (isEditing) updateMut.mutate(data);
    else createMut.mutate(data);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Role" : "Add Role"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              placeholder="e.g. Sound Engineer, Lighting Tech"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              rows={2}
              placeholder="Brief description of this role..."
              {...form.register("description")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input
                placeholder="e.g. Audio, Lighting"
                {...form.register("department")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <Input type="color" {...form.register("color")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Default Rate</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...form.register("defaultRate")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rate Type</Label>
              <Select
                value={form.watch("rateType") || ""}
                onValueChange={(v) =>
                  form.setValue(
                    "rateType",
                    v as CrewRoleFormValues["rateType"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="FLAT">Flat</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isEditing ? "Save Changes" : "Add Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
