"use client";

/**
 * Job > Logistics (spec 8, UX Phase 5): the facts, three lanes, services as the
 * one row with crew under them, the AddBar, the bulk bar, derived totals once,
 * and (on a phone) day mode in place of the old runsheet page. One data set,
 * two renderings; every write goes through `useLogisticsWrites`, every verb
 * is wired in `logistics-actions`, every sheet lives in `logistics-dialogs`.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";

import { CanDo } from "@/components/auth/permission-gate";
import { ActionMenu } from "@/components/ui/action-menu";
import { BulkBar } from "@/components/ui/bulk-bar";
import { FooterTotals } from "@/components/ui/footer-totals";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { counterLocation, groupByDay, inLane, needsLine, totalsOf, warehouseRoleId, type LogisticsService } from "@/lib/logistics-model";
import { useCrewRoles } from "@/hooks/use-crew";
import { useLocations } from "@/hooks/use-locations";
import { mergeStops } from "@/lib/logistics-transport";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { useCanDo } from "@/lib/use-permissions";
import { AddServiceBar } from "./add-service-bar";
import { LogisticsFacts } from "./facts";
import { LaneBar } from "./lane-bar";
import { LogisticsContent } from "./logistics-content";
import { LogisticsDialogs } from "./logistics-dialogs";
import { buildBulk, buildCrewMenu, buildPageMenu, buildServiceMenu, dayTargetsOf, offerRowsFor, type ActionsCtx } from "./logistics-actions";
import { useLogisticsState } from "./logistics-state";
import { crewRow } from "./people-view";
import { PrintRunsheet } from "./print-runsheet";
import { scheduleFromProject, siteFromProject } from "./schedule-from-project";
import { logisticsColumns, logisticsCostView, logisticsTotalLines, serviceRow } from "./service-rows";
import { useLogisticsData } from "./use-logistics-data";
import { useLogisticsWrites } from "./use-logistics-writes";
import { useQuickAdd } from "./use-quick-add";

/**
 * Sticks above the phone bottom nav while the tab is in view, but stays IN FLOW: at the
 * end of the tab it sits under the list instead of floating over whatever comes next
 * (spec principle 8: nothing floats over content).
 */
function StickyAdd({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky z-30 mt-3" style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.5rem)" }}>
      {children}
    </div>
  );
}


/** `?print=1` (the old runsheet link, redirected here) opens the print dialog once, when data is in. */
function usePrintOnArrival(ready: boolean) {
  const searchParams = useSearchParams();
  const printed = React.useRef(false);
  React.useEffect(() => {
    if (searchParams.get("print") === "1" && ready && !printed.current) {
      printed.current = true;
      window.print();
    }
  }, [searchParams, ready]);
}

type Data = ReturnType<typeof useLogisticsData>;

/** Everything the body derives from the loaded data, the viewer's rights and the UI state. */
function useBodyModel(projectId: string, data: Data) {
  const can = {
    project: useCanDo("project", "update"),
    crew: useCanDo("crew", "update"),
    deleteCrew: useCanDo("crew", "delete"),
  };
  const w = useLogisticsWrites(projectId);
  const ui = useLogisticsState();
  // What the server sent decides the cost view (job cost for the footer, pay for the rows).
  const cost = logisticsCostView(data.summary, data.services, ui.showCost);

  const schedule = scheduleFromProject(data.project);
  const site = siteFromProject(data.project);
  const loadInDay = schedule.loadIn || schedule.rentalStart;
  const loadOutDay = schedule.loadOut || schedule.rentalEnd;
  const where = whereOf(data.project, site);
  const locations = useLocations(data.orgId);
  const roles = useCrewRoles(data.orgId);
  const counterLoc = counterLocation(locations);
  const counter = counterLoc
    ? { address: counterLoc.address ?? "", latitude: counterLoc.latitude ?? null, longitude: counterLoc.longitude ?? null }
    : null;

  // Sub-hire stops are transport: they ride the All and Transport lanes only.
  const stops = ui.lane === "all" || ui.lane === "transport" ? data.stops : [];
  const groups = mergeStops(groupByDay(data.services.filter((s) => inLane(s, ui.lane))), stops);
  const crewShown = ui.heldOnly ? data.crew.filter((a) => a.status === "CONFIRMED" || a.status === "OFFERED") : data.crew;
  const visibleIds = ui.view === "people" ? crewShown.map((a) => a.id) :groups.flatMap((g) => g.services.map((s) => s.id));
  const selection = useRowSelection(visibleIds);
  const { clear, selected } = selection;
  const { view, lane } = ui;
  React.useEffect(() => clear(), [view, lane, clear]);

  const actions: ActionsCtx = {
    can, w, ui, clear,
    selectedServices: data.services.filter((s) => selected.has(s.id)),
    selectedCrew: data.crew.filter((a) => selected.has(a.id)),
    dayTargets: dayTargetsOf(groups),
  };
  const quick = useQuickAdd(
    {
      projectId, ...where, window: { start: loadInDay, end: loadOutDay }, templates: data.templates,
      counter, warehouseRoleId: warehouseRoleId(roles),
    },
    (id) => ui.setEditId(id),
  );
  const pageMenu = buildPageMenu({
    projectId, services: data.services, crew: data.crew, conflicts: data.conflicts, hasWindow: !!(loadInDay || loadOutDay),
    showCost: ui.showCost, can, canSeeCost: cost.canSeeCost, w, ui,
  });
  usePrintOnArrival(true);
  return {
    crewShown, can, w, ui, schedule, site, loadInDay, loadOutDay, where, groups, selection, actions, quick, pageMenu,
    showCost: cost.rows,
    showFooterCost: cost.footer,
  };
}

function whereOf(project: Data["project"], site: { address: string }) {
  const loc = (project?.location ?? null) as { latitude?: number | null; longitude?: number | null } | null;
  return { address: site.address, latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null };
}

/** Under the list: the AddBar and bulk bar on a desktop, the totals once. */
function ListFooter({ m, data }: { m: ReturnType<typeof useBodyModel>; data: Data }) {
  const isMobile = useIsMobile();
  const add = <AddServiceBar templates={data.templates} onAdd={m.quick.add} onOpenEditor={m.quick.openEditor} />;
  const noun = m.ui.view === "people" ? "assignment" : "service";
  return (
    <>
      {!isMobile && <CanDo resource="project" action="update">{add}</CanDo>}
      {!isMobile && m.selection.count > 0 && <BulkBar noun={noun} selection={m.selection} actions={buildBulk(m.actions)} />}
      <FooterTotals lines={logisticsTotalLines(data.summary, m.showFooterCost)} />
    </>
  );
}

/** Phone: one sticky `+ Add service` above the bottom nav, which the bulk bar replaces while anything is ticked. */
function PhoneBar({ m, data }: { m: ReturnType<typeof useBodyModel>; data: Data }) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  const noun = m.ui.view === "people" ? "assignment" : "service";
  const add = <AddServiceBar templates={data.templates} onAdd={m.quick.add} onOpenEditor={m.quick.openEditor} />;
  return (
    <CanDo resource="project" action="update">
      {m.selection.count > 0 ? <BulkBar noun={noun} selection={m.selection} actions={buildBulk(m.actions)} /> : <StickyAdd>{add}</StickyAdd>}
    </CanDo>
  );
}

function LogisticsBody({ projectId, data }: { projectId: string; data: Data }) {
  const m = useBodyModel(projectId, data);
  const { ui, actions } = m;
  const serviceMenu = (s: LogisticsService) => buildServiceMenu(s, actions);
  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-4 print:hidden">
        <LogisticsFacts orgId={data.orgId} projectId={projectId} schedule={m.schedule} site={m.site} canEdit={m.can.project} onEditDates={() => ui.setDatesOpen(true)} />
        <LaneBar
          view={ui.view}
          onView={(v) => { ui.setHeldOnly(false); ui.setView(v); }}
          lane={ui.lane}
          onLane={(l) => { ui.setView("timeline"); ui.setLane(l); }}
          needs={needsLine(totalsOf(data.services))}
          trailing={<ActionMenu spec={m.pageMenu} label="Logistics options" />}
        />
        <LogisticsContent
          view={ui.view}
          hasServices={data.services.length > 0 || data.stops.length > 0}
          hasDates={!!m.loadInDay}
          groups={m.groups}
          crew={m.crewShown}
          heldOnly={ui.heldOnly}
          onShowAll={() => ui.setHeldOnly(false)}
          selection={m.selection}
          columns={logisticsColumns(m.showCost)}
          day={ui.day}
          onDay={ui.setDay}
          loadInDay={m.loadInDay}
          loadOutDay={m.loadOutDay}
          serviceRow={(s) => serviceRow(s, { menu: serviceMenu(s), showCost: m.showCost, onOpen: () => ui.setEditId(s.id) })}
          crewRow={(a) => crewRow(a, { conflict: data.conflicts[a.id], menu: buildCrewMenu(a, actions), onOpen: () => ui.setAssignmentId(a.id) })}
          serviceMenu={serviceMenu}
          onOpenService={(s) => ui.setEditId(s.id)}
          onOpenOrder={ui.setOrderId}
        />
        <ListFooter m={m} data={data} />
      </div>
      <PhoneBar m={m} data={data} />
      <PrintRunsheet title={String(data.project?.name ?? "Job")} services={data.services} site={m.site} />
      <LogisticsDialogs
        p={{
          projectId, orgId: data.orgId, projectStatus: data.project?.status as string | undefined, schedule: m.schedule, site: m.where, contact: { name: m.site.contactName, phone: m.site.contactPhone },
          services: data.services, crew: data.crew, templates: data.templates, ui, w: m.w,
          offerRows: offerRowsFor(ui.offerIds ?? [], data.crew, data.conflicts),
          selectedIds: [...m.selection.selected], clear: m.selection.clear,
        }}
      />
    </div>
  );
}

export function LogisticsTab({ projectId }: { projectId: string }) {
  const data = useLogisticsData(projectId);
  if (data.isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
      </div>
    );
  }
  return <LogisticsBody projectId={projectId} data={data} />;
}
