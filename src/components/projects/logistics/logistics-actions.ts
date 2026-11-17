/**
 * Builds the tab's row menus and bulk verbs from the capability flags, the
 * write functions and the UI setters. Pure (no hooks): the row-action builders
 * in `src/lib/row-actions` decide WHICH verbs exist, this only wires each one
 * to its handler, and omits the handler (so the verb is absent, never
 * disabled) when the caller cannot do it.
 */
import { crewShort, dayLabel, toOffer, type LogisticsService } from "@/lib/logistics-model";
import type { BulkAction } from "@/lib/primitives/types";
import { crewActions, crewBulkActions } from "@/lib/row-actions/crew";
import { logisticsPageMenu } from "@/lib/row-actions/logistics-page";
import { serviceActions, serviceBulkActions, type MoveTarget } from "@/lib/row-actions/service";
import { sendCrewOfferAll } from "@/server/crew-communication";
import { assignmentName, type CrewAssignmentRow } from "./people-view";
import type { Conflict } from "./use-logistics-data";
import type { OfferRow } from "./send-offers-dialog";
import type { LogisticsState } from "./logistics-state";
import type { useLogisticsWrites } from "./use-logistics-writes";

export interface ActionsCtx {
  can: { project: boolean; crew: boolean; deleteCrew: boolean };
  w: ReturnType<typeof useLogisticsWrites>;
  ui: LogisticsState;
  selectedServices: LogisticsService[];
  selectedCrew: CrewAssignmentRow[];
  clear: () => void;
  dayTargets: MoveTarget[];
}

/** `fn` when the capability is held, else undefined (the verb is then absent). */
const when = <F>(ok: boolean, fn: F): F | undefined => (ok ? fn : undefined);

const pendingIds = (s: LogisticsService) => s.crewAssignments.filter((a) => a.status === "PENDING").map((a) => a.id);

export function buildServiceMenu(s: LogisticsService, c: ActionsCtx) {
  const { can, w, ui } = c;
  return serviceActions(s, {
    onEdit: when(can.project, () => ui.setEditId(s.id)),
    onPickCrew: when(can.crew, () => ui.setPickId(s.id)),
    onSendOffers: when(can.crew, () => ui.setOfferIds(pendingIds(s))),
    moveTargets: c.dayTargets,
    onMoveTo: when(can.project, (k: string) => void w.moveServiceToDay(s, k)),
    onSetStatus: when(can.project, (st) => void w.setServiceStatus([s], st)),
    onDelete: when(can.project, () => void w.deleteServices([s.id])),
  });
}

export function buildCrewMenu(a: CrewAssignmentRow, c: ActionsCtx) {
  const { can, w, ui } = c;
  const name = assignmentName(a);
  return crewActions(
    { id: a.id, name, status: a.status },
    {
      onEdit: when(can.crew, () => ui.setAssignmentId(a.id)),
      onSendOffer: when(can.crew, () => ui.setOfferIds([a.id])),
      onMessage: when(can.crew, () => ui.setMessageTarget({ id: a.crewMember.id, name })),
      onSetStatus: when(can.crew, (st: string) => void w.setCrewStatus([a], st)),
      onRemove: when(can.deleteCrew, () => void w.removeCrew([a.id])),
    },
  );
}

function crewBulk(c: ActionsCtx): BulkAction[] {
  const { can, w, ui, selectedCrew, clear } = c;
  const done = (p: Promise<unknown>) => void p.then(clear);
  return crewBulkActions(
    selectedCrew.map((a) => ({ id: a.id, name: assignmentName(a), status: a.status })),
    {
      onSendOffers: when(can.crew, () => ui.setOfferIds(selectedCrew.filter((a) => a.status === "PENDING").map((a) => a.id))),
      onConfirm: when(can.crew, () => done(w.setCrewStatus(selectedCrew, "CONFIRMED"))),
      onSetStatus: when(can.crew, (st: string) => done(w.setCrewStatus(selectedCrew, st))),
      onRemove: when(can.deleteCrew, () => ui.setBulkDelete("crew")),
    },
  );
}

function serviceBulk(c: ActionsCtx): BulkAction[] {
  const { can, w, ui, selectedServices, clear } = c;
  const done = (p: Promise<unknown>) => void p.then(clear);
  const confirmable = selectedServices.filter((s) => s.status !== "CONFIRMED" && s.status !== "CANCELLED");
  return serviceBulkActions(selectedServices, {
    onPickCrew: when(can.crew, () => ui.setPickId(selectedServices.find((s) => crewShort(s) > 0)?.id ?? null)),
    onSendOffers: when(can.crew, () => ui.setOfferIds(selectedServices.flatMap(pendingIds))),
    onConfirm: when(can.project, () => done(w.setServiceStatus(confirmable, "CONFIRMED"))),
    onSetStatus: when(can.project, (st) => done(w.setServiceStatus(selectedServices, st))),
    onDelete: when(can.project, () => ui.setBulkDelete("services")),
  });
}

/** The bulk verbs for whichever list is showing. */
export function buildBulk(c: ActionsCtx): BulkAction[] {
  return c.ui.view === "people" ? crewBulk(c) : serviceBulk(c);
}

/** The days on the timeline a service can be moved to, labelled for the menu. */
export function dayTargetsOf(groups: { key: string; services: unknown[] }[]): MoveTarget[] {
  // A day that holds only a sub-hire stop is not a place to move a service to.
  return groups.filter((g) => g.key && g.services.length > 0).map((g) => ({ key: g.key, label: dayLabel(g.key) }));
}

/** The offer dialog's rows: who gets what, with the advisory clash and the missing-email flag. */
export function offerRowsFor(ids: string[], crew: CrewAssignmentRow[], conflicts: Record<string, Conflict>): OfferRow[] {
  const byId = new Map(crew.map((a) => [a.id, a]));
  return ids.flatMap((id) => {
    const a = byId.get(id);
    return a
      ? [{ id, name: assignmentName(a), email: a.crewMember.email, serviceTitle: a.service?.title ?? "No service", clash: conflicts[id]?.label }]
      : [];
  });
}

export interface PageMenuCtx {
  projectId: string;
  services: LogisticsService[];
  crew: CrewAssignmentRow[];
  conflicts: Record<string, Conflict>;
  hasWindow: boolean;
  showCost: boolean;
  can: ActionsCtx["can"];
  canSeeCost: boolean;
  w: ActionsCtx["w"];
  ui: LogisticsState;
}

/** The tab's page menu, wired to its handlers. */
export function buildPageMenu(c: PageMenuCtx) {
  const { w, ui, projectId } = c;
  return logisticsPageMenu({
    hasServices: c.services.length > 0,
    hasWindow: c.hasWindow,
    offerCount: c.services.reduce((n, s) => n + toOffer(s), 0),
    clashCount: c.crew.filter((a) => a.status === "PENDING" && c.conflicts[a.id]).length,
    crewCount: c.crew.length,
    showCost: c.showCost,
    canEditProject: c.can.project,
    canEditCrew: c.can.crew,
    canSeeCost: c.canSeeCost,
    onEditDates: () => ui.setDatesOpen(true),
    onGenerate: () =>
      void w.run(() => w.svc.generate(projectId), (r) => (r.created === 0 ? "All services already exist" : "Generated " + r.created + " services")),
    onImport: () => ui.setCloneOpen(true),
    onToggleCost: () => ui.setShowCost((v) => !v),
    onCallSheet: () => ui.setCallSheetOpen(true),
    onPrint: () => window.print(),
    onMessage: () => ui.setMessageOpen(true),
    onRequestAvailability: () => ui.setAvailOpen(true),
    onOfferAll: () => void w.run(() => sendCrewOfferAll(projectId), (r) => r.sent + " offers sent"),
  });
}
