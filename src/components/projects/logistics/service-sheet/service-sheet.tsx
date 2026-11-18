"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { SERVICE_TYPE_LABELS } from "@/lib/constants/services";
import type { LogisticsService } from "@/lib/logistics-model";
import { CrewSection, MoneySection, NotesSection } from "./crew-money-sections";
import { recentVehicles } from "./service-form";
import { useServiceSheet } from "./use-service-sheet";
import { WhenSection, WhereSection } from "./when-where-sections";

export interface ServiceSheetProps {
  /** The row being edited, or null while closed. */
  service: LogisticsService | null;
  onClose: () => void;
  projectId: string;
  orgId: string | undefined;
  /** The job's venue address (for `Use venue`) and site contact (for `Use the site contact`). */
  venue: string;
  contact: { name: string; phone: string };
  /** Every service on the job: the recent vehicles are derived from them. */
  services: LogisticsService[];
  onPickCrew: (serviceId: string) => void;
  onRemoveCrew: (assignmentId: string) => void;
  onDelete: (serviceId: string) => void;
}

type BulkStatus = "OFFERED" | "CONFIRMED";

function BulkConfirm(props: { status: BulkStatus | null; clashes: number; total: number; pending: boolean; onClose: () => void; onConfirm: (s: BulkStatus) => void }) {
  const { status, clashes, total, pending, onClose, onConfirm } = props;
  return (
    <DeleteDialog
      open={status != null}
      onOpenChange={(o) => !o && onClose()}
      title={status === "OFFERED" ? "Send offers to all assigned crew?" : "Confirm all assigned crew?"}
      description={
        <>
          {status === "OFFERED"
            ? "Every pending crew member on this service receives their offer email or SMS now."
            : "Every accepted crew member on this service is marked confirmed."}
          {clashes > 0 && (
            <span className="mt-1.5 block font-medium text-warn">
              {clashes} of {total} have scheduling clashes. This doesn&apos;t block the action.
            </span>
          )}
        </>
      }
      confirmLabel={status === "OFFERED" ? "Send offers" : "Confirm all"}
      onConfirm={() => status && onConfirm(status)}
      pending={pending}
    />
  );
}

function Body({ p, service }: { p: ServiceSheetProps; service: LogisticsService }) {
  const s = useServiceSheet({ service, projectId: p.projectId, orgId: p.orgId, onClose: p.onClose });
  const [bulk, setBulk] = React.useState<BulkStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const errors = s.form.formState.errors;
  const byMember = new Map(service.crewAssignments.map((a) => [a.crewMember.id, a.id]));
  const hasPending = service.crewAssignments.some((a) => a.status === "PENDING");
  const hasAccepted = service.crewAssignments.some((a) => a.status === "ACCEPTED");
  return (
    <form onSubmit={s.form.handleSubmit((d) => s.save.mutate(d))} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="space-y-5 overflow-y-auto px-4 pb-4 sm:px-6">
        <Input aria-label="Title" placeholder="Service title" className="h-10 text-base font-semibold" {...s.form.register("title")} />
        <WhenSection s={s} />
        <WhereSection s={s} venue={p.venue} vehicles={recentVehicles(p.services)} siteContact={p.contact} />
        <CrewSection
          s={s}
          onPick={() => p.onPickCrew(service.id)}
          onRemove={(memberId) => { const id = byMember.get(memberId); if (id) p.onRemoveCrew(id); }}
          onBulk={setBulk}
          hasPending={hasPending}
          hasAccepted={hasAccepted}
        />
        <MoneySection s={s} />
        <NotesSection s={s} />
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-elev px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" className="touch-target text-t-out" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="line" className="touch-target" onClick={p.onClose}>Cancel</Button>
        <Button type="submit" className="touch-target" disabled={s.save.isPending}>
          {s.save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
      {errors.title && <p role="alert" className="px-6 pb-2 text-caption text-t-out">{errors.title.message}</p>}
      <BulkConfirm
        status={bulk}
        clashes={s.clashes}
        total={s.rows.length}
        pending={s.crewStatus.isPending}
        onClose={() => setBulk(null)}
        onConfirm={(status) => { s.crewStatus.mutate({ status }); setBulk(null); }}
      />
      <DeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete service"
        description="This removes the service and its crew assignments from the job."
        confirmLabel="Delete"
        onConfirm={() => { setConfirmDelete(false); p.onDelete(service.id); p.onClose(); }}
        pending={false}
      />
    </form>
  );
}

/**
 * The service sheet (spec §8): five sections, When / Where / Crew / Money / Notes,
 * over a Dialog on desktop and a bottom sheet on the phone. Replaces
 * `ServiceDialog`; every field and gate it had (pricing lock, rate table, clash
 * badges) is kept.
 */
export function ServiceSheet(p: ServiceSheetProps) {
  const isMobile = useIsMobile();
  const open = p.service != null;
  const onOpenChange = (o: boolean) => { if (!o) p.onClose(); };
  if (!p.service) return null;
  const body = <Body key={p.service.id} p={p} service={p.service} />;
  if (isMobile) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title={`Edit ${SERVICE_TYPE_LABELS[p.service.type].toLowerCase()}`} className="max-h-[92dvh]">
        {body}
      </BottomSheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-3 overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="t-overline text-muted">Edit {SERVICE_TYPE_LABELS[p.service.type].toLowerCase()}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
