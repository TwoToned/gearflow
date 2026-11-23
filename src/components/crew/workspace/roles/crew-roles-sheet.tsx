"use client";

import * as React from "react";
import { useConvex } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCrewRolesForSettings, type CrewRoleDoc } from "@/hooks/use-crew";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveOrganization } from "@/lib/auth-client";
import { factText } from "@/lib/primitives/facts";
import { buildCrewRoleActions } from "@/lib/row-actions/crew-role";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCanDo } from "@/lib/use-permissions";
import { compareRoleOrder } from "../../../../../convex/lib/crewRoleOrder";
import { RoleEditor } from "./role-editor";
import { useRoleSheetWrites } from "./use-role-writes";

/**
 * Crew roles & rates (spec §9h.5): what `/crew/settings` was, as a sheet from
 * the Crew page ⋯ (both views; the old route redirects to `?sheet=roles`).
 * Active roles in display order, archived ones under a muted head. Cost and
 * charge show for managers only, and the SERVER strips them below manager
 * (`crewRoles.listForSettings`); blank stays blank, never $0.
 */

type Usage = { crewMembers: number; crewAssignments: number; projectServices: number };

/** The org's roles in display order — the SAME order `moveNative` renumbers by (read only while the sheet is open). */
function useSortedRoles(orgId: string | undefined): CrewRoleDoc[] {
  const roles = useCrewRolesForSettings(orgId);
  return React.useMemo(() => [...(roles ?? [])].sort(compareRoleOrder), [roles]);
}

function rate(value: number | undefined | null): string {
  return value == null ? "—" : factText({ kind: "money", amount: value });
}

function RoleRow({ role, showRates, menu }: { role: CrewRoleDoc; showRates: boolean; menu: React.ReactNode }) {
  const archived = role.isActive === false;
  return (
    <div className={`flex min-h-12 items-center gap-3 border-t border-line py-2 ${archived ? "opacity-60" : ""}`}>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full border border-line" style={{ backgroundColor: role.color || "transparent" }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-text font-medium text-ink">{role.name}</div>
        <div className="truncate text-caption text-muted">{[role.department, role.rateType ? crewRateTypeLabels[role.rateType] : null].filter(Boolean).join(" · ") || "No department"}</div>
      </div>
      {showRates && (
        <div className="text-right font-mono text-caption tabular-nums">
          <div className="text-ink">{rate(role.defaultRate)}</div>
          <div className="text-muted">{rate(role.chargeRate)}</div>
        </div>
      )}
      {menu}
    </div>
  );
}

function ArchiveDialog({
  role,
  usage,
  onCancel,
  onConfirm,
}: {
  role: CrewRoleDoc | null;
  usage: Usage | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!role} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{`Archive “${role?.name ?? ""}”?`}</DialogTitle>
          <DialogDescription>
            {usage
              ? `${usage.crewMembers} crew ${usage.crewMembers === 1 ? "member has" : "members have"} this role and ${usage.crewAssignments} ${usage.crewAssignments === 1 ? "call uses" : "calls use"} it. They keep it; it just stops appearing when you add crew to a job. You can restore it later.`
              : "Checking where this role is used…"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={onCancel}>
            Keep it
          </Button>
          <Button type="button" variant="line" className="text-t-out" onClick={onConfirm}>
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useArchiveTarget(orgId: string | undefined) {
  const convex = useConvex();
  const [target, setTarget] = React.useState<{ role: CrewRoleDoc; usage: Usage | null } | null>(null);
  const open = async (role: CrewRoleDoc) => {
    setTarget({ role, usage: null });
    if (!orgId) return;
    try {
      const usage = await convex.query(api.crewRoles.usage, { id: role.id, orgId });
      setTarget((t) => (t?.role.id === role.id ? { role, usage } : t));
    } catch {
      // Usage is informational; the archive itself stays available.
    }
  };
  return { target, open, close: () => setTarget(null) };
}

function RoleList({ roles, showRates, menuFor }: { roles: CrewRoleDoc[]; showRates: boolean; menuFor: (r: CrewRoleDoc) => React.ReactNode }) {
  const active = roles.filter((r) => r.isActive !== false);
  const archived = roles.filter((r) => r.isActive === false);
  if (roles.length === 0) return <p className="py-6 text-center text-caption text-muted">No crew roles yet. A role carries the cost rate crew are paid and the charge rate the quote bills.</p>;
  return (
    <div>
      {showRates && (
        <div className="flex justify-end gap-3 pb-1 text-caption text-muted">
          <span>Cost / charge</span>
          <span className="w-10" aria-hidden="true" />
        </div>
      )}
      {active.map((r) => (
        <RoleRow key={r.id} role={r} showRates={showRates} menu={menuFor(r)} />
      ))}
      {archived.length > 0 && (
        <>
          <div className="pt-4 pb-1 text-caption font-semibold text-muted">
            Archived <span className="font-mono font-normal">{archived.length}</span>
          </div>
          {archived.map((r) => (
            <RoleRow key={r.id} role={r} showRates={showRates} menu={menuFor(r)} />
          ))}
        </>
      )}
    </div>
  );
}

function ArchiveHost({ archive, onArchive }: { archive: ReturnType<typeof useArchiveTarget>; onArchive: (r: CrewRoleDoc) => void }) {
  const target = archive.target;
  return (
    <ArchiveDialog
      role={target ? target.role : null}
      usage={target ? target.usage : null}
      onCancel={archive.close}
      onConfirm={() => {
        archive.close();
        if (target) onArchive(target.role);
      }}
    />
  );
}

interface RoleHandlers {
  edit: (r: CrewRoleDoc) => void;
  move: (r: CrewRoleDoc, d: "up" | "down") => void;
  archive: (r: CrewRoleDoc) => void;
  restore: (r: CrewRoleDoc) => void;
}

/** Each row's ⋯ from the one builder; no `crew:update` = no items (an empty slot keeps the columns aligned). */
function roleMenuFor(roles: CrewRoleDoc[], canUpdate: boolean, h: RoleHandlers) {
  const active = roles.filter((r) => r.isActive !== false);
  return function roleMenu(r: CrewRoleDoc) {
    const ctx = canUpdate
      ? { onEdit: () => h.edit(r), onMove: (d: "up" | "down") => h.move(r, d), onArchive: () => h.archive(r), onRestore: () => h.restore(r) }
      : {};
    const spec = buildCrewRoleActions({ isActive: r.isActive !== false, index: active.indexOf(r), activeCount: active.length }, ctx);
    return spec.items.length > 0 ? <ActionMenu spec={spec} label={`${r.name} actions`} /> : <span className="w-10" aria-hidden="true" />;
  };
}

export function CrewRolesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const roles = useSortedRoles(open ? orgId : undefined);
  // The SERVER's answer (`crewRoles.ratesVisible` = canSeeCrewPay), never the client's role.
  const showRates = useAuthedQuery(api.crewRoles.ratesVisible, open && orgId ? { orgId } : "skip") === true;
  const canCreate = useCanDo("crew", "create");
  const canUpdate = useCanDo("crew", "update");
  const w = useRoleSheetWrites({ ratesShown: showRates });
  const archive = useArchiveTarget(orgId);
  const [editing, setEditing] = React.useState<CrewRoleDoc | null | undefined>(undefined);
  const menuFor = roleMenuFor(roles, canUpdate, {
    edit: setEditing,
    move: (r, d) => void w.move(r, d),
    archive: (r) => void archive.open(r),
    restore: (r) => void w.setActive(r, true),
  });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side={isMobile ? "bottom" : "right"} className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Crew roles &amp; rates</SheetTitle>
            <SheetDescription>
              Roles set the cost rate crew get on a call and the charge rate on the quote.{showRates ? "" : " Cost and charge show for managers only."}
            </SheetDescription>
          </SheetHeader>
          <RoleList roles={roles} showRates={showRates} menuFor={menuFor} />
          <SheetFooter>
            {canCreate && (
              <Button type="button" variant="line" onClick={() => setEditing(null)}>
                New role
              </Button>
            )}
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </SheetFooter>
          {/* Nested inside the sheet (Radix stacks the layers), both Radix: never a Base UI popup here. */}
          <RoleEditor role={editing} showRates={showRates} onOpenChange={(o) => !o && setEditing(undefined)} onSave={w.save} />
          <ArchiveHost archive={archive} onArchive={(r) => void w.setActive(r, false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
