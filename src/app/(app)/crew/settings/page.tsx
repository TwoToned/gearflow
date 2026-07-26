"use client";
// use-client: interactive form (react-hook-form + client validation) (R-8.1.1)

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useConvex } from "convex/react";
import { Plus, Pencil, Archive, ArchiveRestore, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { crewRoleSchema, type CrewRoleFormValues } from "@/lib/validations/crew";
import { useCrewRoleWrites } from "@/hooks/use-crew-role-writes";
import { useCrewRolesForSettings, type CrewRoleDoc } from "@/hooks/use-crew";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
import { useCanDo, useIsManagerPlus } from "@/lib/use-permissions";
import { RequirePermission } from "@/components/auth/require-permission";
import { useActiveOrganization } from "@/lib/auth-client";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { formatCurrency } from "@/lib/formatters";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { api } from "../../../../../convex/_generated/api";

type UsageCounts = { crewMembers: number; crewAssignments: number; projectServices: number };

/**
 * Roles admin (WS10 #949 — labour charge rates & margin). The missing write
 * surface for CrewRole: `convex/crewRoles.ts`'s mutations all gated on the trusted-
 * backend-only `requireService` with zero callers in `src/`, and `/crew/settings`
 * was referenced from the sidebar/page-commands/slash-commands/FEATUREDOCS for a
 * route that never existed. This page + `crewRolesWrites.ts` + `use-crew-role-writes.ts`
 * close that gap.
 *
 * Cost (`defaultRate`) and charge (`chargeRate`) columns render only for manager+
 * (`useIsManagerPlus()`) — server-enforced too: `useCrewRolesForSettings` calls
 * `crewRoles.listForSettings`, which strips both fields for non-manager+ callers.
 * Everyone with `crew:read` (every built-in role) can view the rest of the table;
 * create/update/archive gate on `crew:create`/`crew:update`, which — per
 * `rolePermissions` — only owner/admin/manager hold, so the whole write surface is
 * already manager+-only in practice.
 */
export default function CrewSettingsPage() {
  return (
    <RequirePermission resource="crew" action="read">
      <CrewSettingsContent />
    </RequirePermission>
  );
}

/** Full field set for a reorder/edit patch — updateNative is a full patch, not
 *  partial (see crewRolesWrites.ts), so every caller must resend every field. */
function roleToFormValues(r: CrewRoleDoc, sortOrder?: number): CrewRoleFormValues {
  return {
    name: r.name,
    description: r.description || "",
    department: r.department || "",
    color: r.color || "",
    defaultRate: r.defaultRate ?? undefined,
    rateType: r.rateType || "",
    chargeRate: r.chargeRate ?? undefined,
    sortOrder: sortOrder ?? r.sortOrder ?? 0,
    isActive: r.isActive ?? true,
  };
}

function CrewSettingsContent() {
  const canCreate = useCanDo("crew", "create");
  const canUpdate = useCanDo("crew", "update");
  const isManagerPlus = useIsManagerPlus();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();

  const [editingRole, setEditingRole] = useState<CrewRoleDoc | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ role: CrewRoleDoc; usage: UsageCounts | null } | null>(null);

  const allRoles = useCrewRolesForSettings(orgId);
  const isLoading = allRoles === undefined;
  const roles = [...(allRoles ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));

  const writes = useCrewRoleWrites();

  const archiveMutation = useServerMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => writes.archive(id, isActive),
    onSuccess: (result) => {
      const r = result as { isActive: boolean };
      toast.success(r.isActive ? "Crew role restored" : "Crew role archived");
      setArchiveTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  function openCreate() {
    setEditingRole(null);
    setDialogOpen(true);
  }

  function openEdit(role: CrewRoleDoc) {
    setEditingRole(role);
    setDialogOpen(true);
  }

  /** Swap sortOrder with the adjacent role in the list. */
  function move(role: CrewRoleDoc, direction: "up" | "down") {
    const idx = roles.findIndex((r) => r.id === role.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= roles.length) return;
    const other = roles[swapIdx];
    writes.update(role.id, roleToFormValues(role, other.sortOrder ?? 0)).catch((e) => toast.error(e instanceof Error ? e.message : "Failed to reorder"));
    writes.update(other.id, roleToFormValues(other, role.sortOrder ?? 0)).catch((e) => toast.error(e instanceof Error ? e.message : "Failed to reorder"));
  }

  async function openArchiveConfirm(role: CrewRoleDoc) {
    setArchiveTarget({ role, usage: null });
    if (!orgId) return;
    try {
      const usage = await convex.query(api.crewRoles.usage, { id: role.id, orgId });
      setArchiveTarget({ role, usage });
    } catch {
      setArchiveTarget({ role, usage: null });
    }
  }

  return (
    <FadeIn>
      <div className="space-y-4">
        <PageHeader
          title="Crew roles"
          description="Roles set the default cost & charge rate crew get on a project — the client price and margin auto-calculate from here."
          actions={canCreate ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add role
            </Button>
          ) : undefined}
        />

        <div className="rounded-[var(--r)] border border-line overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Department</TableHead>
                {isManagerPlus && <TableHead className="text-right">Cost rate</TableHead>}
                {isManagerPlus && <TableHead className="text-right">Charge rate</TableHead>}
                <TableHead className="text-right">Active</TableHead>
                {(canUpdate || canCreate) && <TableHead className="w-[140px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell colSpan={6}>
                      <div className="h-5 w-full animate-pulse rounded-[var(--r)] bg-elev" />
                    </TableCell>
                  </TableRow>
                ))
              ) : roles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="text-ui-text text-ink-2">No crew roles yet</p>
                    <p className="text-caption text-muted">
                      Roles carry the default cost rate crew get paid AND the charge rate billed to clients.
                    </p>
                    {canCreate && (
                      <Button size="sm" className="mt-2" onClick={openCreate}>
                        <Plus className="h-4 w-4" />
                        Create first role
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((role, idx) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    isFirst={idx === 0}
                    isLast={idx === roles.length - 1}
                    isManagerPlus={isManagerPlus}
                    canUpdate={canUpdate}
                    onMove={(dir) => move(role, dir)}
                    onEdit={() => openEdit(role)}
                    onArchiveOrRestore={() =>
                      role.isActive === false
                        ? archiveMutation.mutate({ id: role.id, isActive: true })
                        : openArchiveConfirm(role)
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <RoleFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingRole={editingRole}
          isManagerPlus={isManagerPlus}
          writes={writes}
        />

        {/* Archive confirmation (usage-guard: informational, non-blocking) */}
        <DeleteDialog
          open={!!archiveTarget}
          onOpenChange={(open) => !open && setArchiveTarget(null)}
          title={`Archive "${archiveTarget?.role.name}"?`}
          description={<ArchiveUsageSummary usage={archiveTarget?.usage ?? null} />}
          confirmLabel="Archive role"
          onConfirm={() => archiveTarget && archiveMutation.mutate({ id: archiveTarget.role.id, isActive: false })}
          pending={archiveMutation.isPending}
        />
      </div>
    </FadeIn>
  );
}

function ArchiveUsageSummary({ usage }: { usage: UsageCounts | null }) {
  if (!usage) return <>Checking usage...</>;
  return (
    <>
      Archiving hides this role from new assignment pickers — existing rows keep it.
      Currently used by{" "}
      <strong>{usage.crewMembers} crew member{usage.crewMembers === 1 ? "" : "s"}</strong>,{" "}
      <strong>{usage.crewAssignments} assignment{usage.crewAssignments === 1 ? "" : "s"}</strong>, and{" "}
      <strong>{usage.projectServices} service{usage.projectServices === 1 ? "" : "s"}</strong>.
    </>
  );
}

function RoleRow({
  role,
  isFirst,
  isLast,
  isManagerPlus,
  canUpdate,
  onMove,
  onEdit,
  onArchiveOrRestore,
}: {
  role: CrewRoleDoc;
  isFirst: boolean;
  isLast: boolean;
  isManagerPlus: boolean;
  canUpdate: boolean;
  onMove: (direction: "up" | "down") => void;
  onEdit: () => void;
  onArchiveOrRestore: () => void;
}) {
  const rateLabel = (rate: number | undefined) =>
    rate != null ? `${formatCurrency(rate)}${role.rateType ? ` /${crewRateTypeLabels[role.rateType].toLowerCase()}` : ""}` : "—";

  return (
    <TableRow className={role.isActive === false ? "opacity-50" : undefined}>
      <TableCell>
        <div className="flex items-center gap-2">
          {role.color && (
            <span className="inline-block size-3 shrink-0 rounded-full border border-line" style={{ backgroundColor: role.color }} />
          )}
          <span className="font-medium text-ink">{role.name}</span>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-muted">{role.department || "—"}</TableCell>
      {isManagerPlus && <TableCell className="text-right t-data">{rateLabel(role.defaultRate)}</TableCell>}
      {isManagerPlus && <TableCell className="text-right t-data">{rateLabel(role.chargeRate)}</TableCell>}
      <TableCell className="text-right">
        <Badge status={role.isActive === false ? "neutral" : "ok"}>
          {role.isActive === false ? "Archived" : "Active"}
        </Badge>
      </TableCell>
      {canUpdate && (
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" onClick={() => onMove("up")} disabled={isFirst} title="Move up">
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" onClick={() => onMove("down")} disabled={isLast} title="Move down">
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" onClick={onEdit} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-7 md:w-7"
              title={role.isActive === false ? "Restore" : "Archive"}
              onClick={onArchiveOrRestore}
            >
              {role.isActive === false ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

/** Self-contained create/edit dialog — owns its own form state so the parent
 *  page component doesn't have to (kept the parent under the R-3.7 length/
 *  complexity budget). */
function RoleFormDialog({
  open,
  onOpenChange,
  editingRole,
  isManagerPlus,
  writes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRole: CrewRoleDoc | null;
  isManagerPlus: boolean;
  writes: ReturnType<typeof useCrewRoleWrites>;
}) {
  const isEditing = !!editingRole;
  const defaultValues: CrewRoleFormValues = editingRole
    ? roleToFormValues(editingRole)
    : { name: "", description: "", department: "", color: "", rateType: "", isActive: true };

  const form = useForm<CrewRoleFormValues>({
    resolver: zodResolver(crewRoleSchema),
    defaultValues,
    values: open ? defaultValues : undefined,
  });

  const createMutation = useServerMutation({
    mutationFn: (data: CrewRoleFormValues) => writes.create(data),
    onSuccess: () => {
      toast.success("Crew role created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: (data: CrewRoleFormValues) => writes.update(editingRole!.id, data),
    onSuccess: () => {
      toast.success("Crew role updated");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function onSubmit(data: CrewRoleFormValues) {
    if (isEditing) updateMutation.mutate(data);
    else createMutation.mutate(data);
  }

  const watchRateType = form.watch("rateType") || "";
  const rateUnitSuffix = watchRateType ? ` / ${crewRateTypeLabels[watchRateType].toLowerCase()}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit crew role" : "New crew role"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" {...form.register("name")} placeholder="e.g. Audio Technician" aria-invalid={!!form.formState.errors.name} />
            {form.formState.errors.name && (
              <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="role-dept">Department</Label>
              <Input id="role-dept" {...form.register("department")} placeholder="e.g. Audio" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-color">Colour</Label>
              <Input id="role-color" type="color" {...form.register("color")} className="h-9 w-full p-1" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-desc">Description</Label>
            <Textarea id="role-desc" {...form.register("description")} placeholder="Optional description" rows={2} />
          </div>

          <div className="space-y-2 rounded-[var(--r)] border border-line p-3">
            <Label>Rate type</Label>
            <Select value={watchRateType} onValueChange={(v) => form.setValue("rateType", v as "HOURLY" | "DAILY" | "FLAT")}>
              <SelectTrigger>
                <SelectValue placeholder="Select rate type...">
                  {watchRateType ? crewRateTypeLabels[watchRateType] : "Select rate type..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HOURLY">{crewRateTypeLabels.HOURLY}</SelectItem>
                <SelectItem value="DAILY">{crewRateTypeLabels.DAILY}</SelectItem>
                <SelectItem value="FLAT">{crewRateTypeLabels.FLAT}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-faint">Governs both the cost rate and the charge rate below.</p>
          </div>

          {isManagerPlus ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="role-cost">Cost rate ($){rateUnitSuffix}</Label>
                <Input id="role-cost" type="number" step="0.01" {...form.register("defaultRate")} placeholder="0.00" />
                <p className="text-[11px] text-faint">What this role costs the business (internal — not shown to clients).</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-charge">Charge rate ($){rateUnitSuffix}</Label>
                <Input id="role-charge" type="number" step="0.01" {...form.register("chargeRate")} placeholder="0.00" />
                <p className="text-[11px] text-faint">Client-facing rate. Auto-prices labour services once crew are assigned. Leave blank for no auto-pricing.</p>
              </div>
            </div>
          ) : (
            <p className="text-caption text-muted">Cost and charge rates are only visible to managers.</p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="line" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>
              {isEditing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
