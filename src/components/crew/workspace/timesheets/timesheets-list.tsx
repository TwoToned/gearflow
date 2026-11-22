"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { api } from "../../../../../convex/_generated/api";
import { useCrewWorkspace } from "@/components/crew/workspace/crew-workspace";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  TIMESHEET_ITEM_HEADER,
  TIMESHEET_ITEM_SORT_KEY,
  TIMESHEETS_SPEC,
  TIMESHEETS_VIEW_ALIASES,
  entryDay,
  jobText,
  personName,
  timeEntryRowOf,
  timesheetColumns,
  timesheetFilters,
  timesheetSegments,
  timesheetsQueryArgs,
  timesText,
  totalsText,
  type TimeEntrySource,
} from "@/lib/list-views/timesheets";
import type { ActionItem, LineRowData } from "@/lib/primitives/types";
import { buildTimeEntryActions, buildTimeEntryBulkActions } from "@/lib/row-actions/time-entry";
import { useCanDo } from "@/lib/use-permissions";
import { ExportDialog } from "./export-dialog";
import { LogTimeSheet, type LogTimePerson } from "./log-time-sheet";
import { QueryDialog } from "./query-dialog";
import { TimeEntrySheet } from "./time-entry-sheet";
import type { AssignmentOption } from "./time-entry-fields";
import { useTimesheetWrites } from "./use-timesheet-writes";
import { canTransition } from "../../../../../convex/lib/timeEntryTransitions";

/**
 * Crew › Timesheets (UX Phase 15, spec §9h.4) on `ListPage`: the URL is the
 * state (strip, Person / Status, sort, page, search), rows through
 * `LineRowList`, bulk Approve / Submit / Query… / Export, the row ⋯, Edit
 * entry and Log time as sheets. Rate (pay) / Total render only when the server
 * returned them (`payVisible`); the client never decides who sees pay.
 *
 * Keyed by the active org, so an org switch drops the selection and the seen
 * rows before anything can act on them.
 */
export function TimesheetsList() {
  const { data: activeOrg } = useActiveOrganization();
  return <TimesheetsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

interface PageResult {
  entries: TimeEntrySource[];
  total: number;
  counts: Record<string, number>;
  totals: { hours: number; pay?: number };
  payVisible: boolean;
}

interface PickerMember {
  id: string;
  firstName: string;
  lastName: string;
  department: string | null;
  crewRole: { name: string } | null;
  assignments: { id: string; status?: string | null; project: { name: string; projectNumber: string } | null; crewRole: { name: string } | null }[];
}

function assignmentOptions(m: PickerMember | undefined): AssignmentOption[] {
  return (m?.assignments ?? []).map((a) => ({
    id: a.id,
    label: `${a.project?.projectNumber ?? ""} ${a.project?.name ?? "Job"}${a.crewRole?.name ? ` (${a.crewRole.name})` : ""}`.trim(),
  }));
}

/** The roster the Person filter and Log time read (one query, no rates below manager). */
function usePeople(orgId: string | undefined) {
  const list = useAuthedQuery(api.crewDashboard.pickerList, orgId ? { orgId } : "skip") as PickerMember[] | undefined;
  return React.useMemo(() => {
    const members = list ?? [];
    const byId = new Map(members.map((m) => [m.id, m]));
    const people: LogTimePerson[] = members.map((m) => ({
      id: m.id,
      name: `${m.firstName} ${m.lastName}`.trim(),
      detail: m.crewRole?.name ?? m.department ?? "",
      assignments: assignmentOptions(m),
    }));
    return { people, assignmentsOf: (id: string) => assignmentOptions(byId.get(id)) };
  }, [list]);
}

/** Desktop job cell: `#2336 Hilton gala`, under it the description and any query reason. */
function JobCell({ e }: { e: TimeEntrySource }) {
  const sub = [e.description].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="truncate text-table-cell text-ink">{jobText(e)}</div>
      {(sub || e.queryReason) && (
        <div className="truncate text-caption text-muted">
          {sub}
          {sub && e.queryReason ? " · " : ""}
          {e.queryReason && <span className="text-warn">{e.queryReason}</span>}
        </div>
      )}
    </div>
  );
}

function DateCell({ e }: { e: TimeEntrySource }) {
  return (
    <div className="whitespace-nowrap">
      <div className="font-mono text-table-cell tabular-nums text-ink-2">{entryDay(e.date)}</div>
      <div className="font-mono text-caption tabular-nums text-muted">{timesText(e)}</div>
    </div>
  );
}

interface Perms {
  update: boolean;
  create: boolean;
  remove: boolean;
}

function useTimesheetSlashEvents(open: { log: () => void; exportAll: () => void }) {
  const latest = React.useRef(open);
  React.useEffect(() => {
    latest.current = open;
  });
  React.useEffect(() => {
    const handler = (e: Event) => {
      const dialog = (e as CustomEvent<{ dialog?: string }>).detail?.dialog;
      if (dialog === "log-time") latest.current.log();
      if (dialog === "export-timesheets") latest.current.exportAll();
    };
    window.addEventListener("slash-command", handler);
    return () => window.removeEventListener("slash-command", handler);
  }, []);
}

/** The page as the list reads it; `loading` while the subscription has nothing yet. */
function pageView(page: PageResult | undefined) {
  if (!page) return { items: [] as TimeEntrySource[], payVisible: false, total: 0, counts: undefined, totals: undefined, loading: true };
  return { items: page.entries, payVisible: page.payVisible, total: page.total, counts: page.counts, totals: page.totals, loading: false };
}

type Writes = ReturnType<typeof useTimesheetWrites>;

/** The sheets and dialogs the list opens; null / false = closed. */
interface Overlays {
  editing: TimeEntrySource | null;
  setEditing: (e: TimeEntrySource | null) => void;
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  queryIds: string[] | null;
  setQueryIds: (ids: string[] | null) => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
}

function useOverlays(): Overlays {
  const [editing, setEditing] = React.useState<TimeEntrySource | null>(null);
  const [logOpen, setLogOpen] = React.useState(false);
  const [queryIds, setQueryIds] = React.useState<string[] | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  return { editing, setEditing, logOpen, setLogOpen, queryIds, setQueryIds, exportOpen, setExportOpen };
}

/** A handler only when the caller may (an absent handler = an absent verb). */
const when = <F,>(allowed: boolean, f: F): F | undefined => (allowed ? f : undefined);

/** One entry as a row: its ⋯ from the shared builder, the desktop job/date cells, open = Edit entry. */
function entryRow(e: TimeEntrySource, a: { perms: Perms; isMobile: boolean; w: Writes; o: Overlays; push: (href: string) => void }): LineRowData {
  const { perms, w, o } = a;
  const menu = buildTimeEntryActions(
    { title: entryName(e), status: e.status },
    {
      onEdit: when(perms.update, () => o.setEditing(e)),
      onSubmit: when(perms.update, () => void w.transition("submit", [e.id])),
      onApprove: when(perms.update, () => void w.transition("approve", [e.id])),
      onQuery: when(perms.update, () => o.setQueryIds([e.id])),
      onOpenPerson: () => a.push(`/crew/${e.crewMemberId}`),
      onDelete: when(perms.remove, () => void w.remove(e.id)),
    },
  );
  const editable = perms.update && e.status !== "EXPORTED";
  const row = timeEntryRowOf(e, { phone: a.isMobile, menu: menu.items.length ? menu : undefined, onOpen: when(editable, () => o.setEditing(e)) });
  return a.isMobile ? row : { ...row, cells: { job: <JobCell e={e} />, date: <DateCell e={e} /> } };
}

/** `Ana Ruiz · Fri 7 Nov`: how a toast or a confirm names one entry. */
const entryName = (e: TimeEntrySource) => `${personName(e)} · ${entryDay(e.date)}`;

/** Every entry seen so far (phone pages accumulate): handlers read the row at click time. */
function useSeenEntries(items: TimeEntrySource[]) {
  const seen = React.useRef(new Map<string, TimeEntrySource>());
  React.useEffect(() => {
    for (const e of items) seen.current.set(e.id, e);
  }, [items]);
  const nameOf = (id: string) => {
    const e = seen.current.get(id);
    return e ? entryName(e) : "Entry";
  };
  const statusOf = (id: string) => seen.current.get(id)?.status ?? "DRAFT";
  return { nameOf, statusOf };
}

function TimesheetsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { state, setState } = useListUrlState(TIMESHEETS_SPEC);
  const ws = useCrewWorkspace("timesheets");
  const perms: Perms = { update: useCanDo("crew", "update"), create: useCanDo("crew", "create"), remove: useCanDo("crew", "delete") };

  const page = useAuthedQuery(api.crewTimeEntries.allEntries, orgId ? { orgId, ...timesheetsQueryArgs(state) } : "skip") as PageResult | undefined;
  const view = pageView(page);
  const { people, assignmentsOf } = usePeople(orgId);
  const [personSearch, setPersonSearch] = React.useState("");
  const { nameOf, statusOf } = useSeenEntries(view.items);
  const w = useTimesheetWrites({ nameOf, canDelete: perms.remove });
  const o = useOverlays();
  useTimesheetSlashEvents({ log: () => perms.create && o.setLogOpen(true), exportAll: () => o.setExportOpen(true) });

  const rows = view.items.map((e) => entryRow(e, { perms, isMobile, w, o, push: router.push }));
  const bulk = (ids: string[]) =>
    buildTimeEntryBulkActions(ids.map(statusOf), {
      onApprove: when(perms.update, () => void w.transition("approve", ids)),
      onSubmit: when(perms.update, () => void w.transition("submit", ids)),
      onQuery: when(perms.update, () => o.setQueryIds(ids.filter((id) => canTransition(statusOf(id), "query")))),
      onExport: () => void w.exportRows(ids),
    });
  const exportAll: ActionItem = { key: "export-all", label: "Export all…", group: "reporting", icon: Download, onSelect: () => o.setExportOpen(true) };
  const primary: ListPrimary | undefined = when(perms.create, { label: "Log time", onSelect: () => o.setLogOpen(true) });

  return (
    <>
      <ListPage
        spec={TIMESHEETS_SPEC}
        title="Crew"
        headWords={ws.headWords}
        // ListFooter / BulkBar pluralise with a bare "s" ("1 entrie", "2 entrys"), so these
        // read "lines" until those primitives take an irregular plural (flagged for the overseer).
        noun="lines"
        bulkNoun="line"
        searchPlaceholder="Search person, job or note"
        segments={timesheetSegments(view.counts)}
        filters={timesheetFilters(people, { value: personSearch, onChange: setPersonSearch })}
        columnsKey="timesheets"
        columns={timesheetColumns(view.payVisible)}
        rows={rows}
        total={view.total}
        loading={view.loading}
        itemHeader={TIMESHEET_ITEM_HEADER}
        itemSortKey={TIMESHEET_ITEM_SORT_KEY}
        primary={primary}
        pageMenu={{ items: [...ws.menuItems, ...(isMobile ? [] : [exportAll])] }}
        bulk={bulk}
        empty={{ title: "No time entries yet", description: "Log time for the crew, or wait for them to submit.", action: primary }}
        toolbarExtra={<UrlSavedViewsMenu tableId="timesheets" spec={TIMESHEETS_SPEC} state={state} setState={setState} aliases={TIMESHEETS_VIEW_ALIASES} />}
      />
      <TotalsLine text={view.total > 0 ? totalsText(view.totals, view.payVisible) : null} />
      <TimesheetOverlays o={o} w={w} people={people} assignmentsOf={assignmentsOf} />
      {ws.rolesSheet}
    </>
  );
}

/** `Totals · 361h · $16,962` under the list (§9h.4); the money only for a pay-visible caller. */
function TotalsLine({ text }: { text: string | null }) {
  return text ? <p className="text-right font-mono text-caption tabular-nums text-muted">{text}</p> : null;
}

function TimesheetOverlays({
  o,
  w,
  people,
  assignmentsOf,
}: {
  o: Overlays;
  w: Writes;
  people: LogTimePerson[];
  assignmentsOf: (crewMemberId: string) => AssignmentOption[];
}) {
  const editing = o.editing;
  return (
    <>
      <TimeEntrySheet
        entry={editing}
        assignments={editing ? assignmentsOf(editing.crewMemberId) : []}
        onOpenChange={(open) => !open && o.setEditing(null)}
        onSave={(next, snapshot) => (editing ? w.update(editing.id, next, snapshot, editing.status) : Promise.resolve(false))}
      />
      <LogTimeSheet open={o.logOpen} onOpenChange={o.setLogOpen} people={people} onLog={(values, chosen) => w.logTime(values, chosen)} />
      <QueryDialog ids={o.queryIds} onOpenChange={(open) => !open && o.setQueryIds(null)} onQuery={(ids, reason) => w.transition("query", ids, reason)} />
      <ExportDialog open={o.exportOpen} onOpenChange={o.setExportOpen} />
    </>
  );
}
