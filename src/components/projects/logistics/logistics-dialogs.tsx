"use client";

/** Every sheet and dialog the tab can open, driven by `LogisticsState`. */
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import { useProjectPricingLock } from "@/hooks/use-project-lock";
import { resolveLockCopy } from "@/lib/lock-copy";
import type { LogisticsService } from "@/lib/logistics-model";
import { AssignmentDialog, BulkMessageDialog, RequestAvailabilityDialog } from "../crew-dialogs";
import { CallSheetDialog } from "../call-sheet-dialog";
import { SubHireOrderDialog } from "../sub-hire-order-dialog";
import { CloneServicesDialog, CrewMessageDialog } from "../service-dialogs";
import { ServiceSheet } from "./service-sheet/service-sheet";
import { LogisticsDatesSheet, type ScheduleSnapshot } from "./dates-sheet";
import type { LogisticsState } from "./logistics-state";
import type { CrewAssignmentRow } from "./people-view";
import { PickCrewSheet } from "./pick-crew-sheet";
import { SendOffersDialog, type OfferRow } from "./send-offers-dialog";
import { refreshLogistics, type useLogisticsWrites } from "./use-logistics-writes";
import type { ServiceTemplateLite } from "./add-service-bar";

export interface DialogsProps {
  projectId: string;
  orgId: string | undefined;
  projectStatus: string | undefined;
  schedule: ScheduleSnapshot;
  site: { address: string; latitude: number | null; longitude: number | null };
  /** The job's site contact, for the client pick up / drop off "Use the site contact" chip. */
  contact: { name: string; phone: string };
  services: LogisticsService[];
  crew: CrewAssignmentRow[];
  templates: (ServiceTemplateLite & Record<string, unknown>)[];
  ui: LogisticsState;
  w: ReturnType<typeof useLogisticsWrites>;
  offerRows: OfferRow[];
  selectedIds: string[];
  clear: () => void;
}

function ServiceEditor({ p }: { p: DialogsProps }) {
  const editing = p.services.find((s) => s.id === p.ui.editId) ?? null;
  return (
    <ServiceSheet
      service={editing}
      onClose={() => p.ui.setEditId(null)}
      projectId={p.projectId}
      orgId={p.orgId}
      venue={p.site.address}
      contact={p.contact}
      services={p.services}
      onPickCrew={(id) => p.ui.setPickId(id)}
      onRemoveCrew={(id) => void p.w.removeCrew([id])}
      onDelete={(id) => void p.w.deleteServices([id])}
    />
  );
}

function AssignmentEditor({ p }: { p: DialogsProps }) {
  const lock = useProjectPricingLock(p.projectId, p.orgId);
  const assignment = p.crew.find((a) => a.id === p.ui.assignmentId);
  if (!assignment) return null;
  return (
    <AssignmentDialog
      projectId={p.projectId}
      open
      onOpenChange={(o) => !o && p.ui.setAssignmentId(null)}
      assignment={assignment as unknown as Record<string, unknown>}
      locked={lock.pricingLocked}
      lockReason={resolveLockCopy(lock).oneLiner}
    />
  );
}

function BulkDelete({ p }: { p: DialogsProps }) {
  const kind = p.ui.bulkDelete;
  const crew = kind === "crew";
  return (
    <BulkDeleteDialog
      open={kind !== null}
      onOpenChange={(o) => !o && p.ui.setBulkDelete(null)}
      title={crew ? "Remove selected crew" : "Delete selected services"}
      description={
        crew
          ? "This removes the selected crew assignments (and their shifts and linked time entries) from the job."
          : "This removes the selected services and their crew assignments from the job."
      }
      count={p.selectedIds.length}
      itemLabel={crew ? "assignment" : "service"}
      pending={false}
      onConfirm={() => {
        p.ui.setBulkDelete(null);
        void (crew ? p.w.removeCrew(p.selectedIds) : p.w.deleteServices(p.selectedIds)).then(p.clear);
      }}
    />
  );
}

export function LogisticsDialogs({ p }: { p: DialogsProps }) {
  const { ui } = p;
  return (
    <>
      <LogisticsDatesSheet
        open={ui.datesOpen}
        onOpenChange={ui.setDatesOpen}
        orgId={p.orgId}
        projectId={p.projectId}
        projectStatus={p.projectStatus}
        snapshot={p.schedule}
        services={p.services}
        onViewHeld={() => { ui.setHeldOnly(true); ui.setView("people"); }}
      />
      <ServiceEditor p={p} />
      <PickCrewSheet
        open={ui.pickId !== null}
        onOpenChange={(o) => !o && ui.setPickId(null)}
        orgId={p.orgId}
        projectId={p.projectId}
        service={p.services.find((s) => s.id === ui.pickId) ?? null}
        onRequestAvailability={() => { ui.setPickId(null); ui.setAvailOpen(true); }}
      />
      <SendOffersDialog
        open={ui.offerIds !== null}
        onOpenChange={(o) => !o && ui.setOfferIds(null)}
        rows={p.offerRows}
        pending={false}
        onConfirm={(ids) => { ui.setOfferIds(null); void p.w.sendOffers(ids).then(p.clear); }}
      />
      <AssignmentEditor p={p} />
      <CloneServicesDialog open={ui.cloneOpen} onOpenChange={ui.setCloneOpen} targetProjectId={p.projectId} onSuccess={() => refreshLogistics(p.projectId)} />
      <CallSheetDialog projectId={p.projectId} open={ui.callSheetOpen} onOpenChange={ui.setCallSheetOpen} />
      <BulkMessageDialog projectId={p.projectId} open={ui.messageOpen} onOpenChange={ui.setMessageOpen} />
      <RequestAvailabilityDialog projectId={p.projectId} open={ui.availOpen} onOpenChange={ui.setAvailOpen} />
      <CrewMessageDialog
        open={!!ui.messageTarget}
        onOpenChange={(o) => !o && ui.setMessageTarget(null)}
        projectId={p.projectId}
        crewMemberId={ui.messageTarget?.id ?? ""}
        crewMemberName={ui.messageTarget?.name ?? ""}
      />
      <BulkDelete p={p} />
      {ui.orderId && (
        <SubHireOrderDialog projectId={p.projectId} open onOpenChange={(o) => !o && ui.setOrderId(null)} subHireId={ui.orderId} />
      )}
    </>
  );
}
