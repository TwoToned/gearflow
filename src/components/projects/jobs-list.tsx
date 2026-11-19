"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FileStack, TriangleAlert } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { ConfirmStatusImpactDialog } from "@/components/projects/confirm-status-impact-dialog";
import { DuplicateProjectDialog } from "@/components/projects/duplicate-project-dialog";
import { ProjectBoard } from "@/components/projects/project-board";
import { ProjectLockGlyph } from "@/components/projects/project-lock-glyph";
import { useJobListWrites } from "@/components/projects/use-job-list-writes";
import { ListPage } from "@/components/ui/list-page";
import type { ListFilterDef, ListPrimary } from "@/components/ui/list-page-parts";
import { SavedViewsMenu } from "@/components/ui/saved-views-menu";
import { StatusWord } from "@/components/ui/status-word";
import { TagPromptDialog } from "@/components/ui/tag-prompt-dialog";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useClients } from "@/hooks/use-clients";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useServerQuery } from "@/hooks/use-server-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  JOB_COLUMNS,
  JOB_ITEM_HEADER,
  JOB_ITEM_SORT_KEY,
  JOBS_SPEC,
  jobFilters,
  jobRowOf,
  jobSegments,
  jobsQueryArgs,
  jobsStateFromView,
  jobsViewConfig,
  type JobSource,
} from "@/lib/list-views/jobs";
import { setFilter, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, LineRowData } from "@/lib/primitives/types";
import { buildJobActions, buildJobBulkActions, type JobActionCtx } from "@/lib/row-actions/job";
import { useCanDo } from "@/lib/use-permissions";
import { getProjectIssueFlags } from "@/server/projects";

type Dialog = { mode: "duplicate" | "template"; project: JobSource } | null;

/** The page-scoped derived flags (overbooking, blocking comments): same queries the old table used. */
function useJobExtras(orgId: string | undefined, items: JobSource[]) {
  const ids = React.useMemo(() => items.map((p) => p.id), [items]);
  const { data: issues } = useServerQuery({
    queryKey: ["project-issues", ids],
    queryFn: () => getProjectIssueFlags(ids),
    enabled: ids.length > 0,
  });
  const blocking = useAuthedQuery(
    api.collaboration.listBlockingForProjects,
    orgId && ids.length > 0 ? { orgId, projectIds: ids } : "skip",
  ) as Record<string, number> | undefined;
  return { issues, blocking };
}

function useJobsPage(orgId: string | undefined, now: number, args: ReturnType<typeof jobsQueryArgs>) {
  const page = useAuthedQuery(api.projects.listPage, orgId ? { orgId, ...args } : "skip");
  const counts = useAuthedQuery(api.projects.segmentCounts, orgId ? { orgId, now } : "skip");
  const { data, total, isLoading } = usePaginatedTableResult(page);
  return { items: data as JobSource[], total, isLoading, counts };
}

interface Perms {
  update: boolean;
  create: boolean;
  remove: boolean;
}

function rowCtxFor(p: JobSource, perms: Perms, w: ReturnType<typeof useJobListWrites>, setDialog: (d: Dialog) => void): JobActionCtx {
  return {
    onSetStatus: perms.update ? (s) => w.setStatusOne(p.id, s) : undefined,
    onDuplicate: perms.create ? () => setDialog({ mode: "duplicate", project: p }) : undefined,
    onSaveAsTemplate: perms.create ? () => setDialog({ mode: "template", project: p }) : undefined,
    onCancel: perms.update ? () => void w.cancelOne(p.id) : undefined,
    onDelete: perms.remove ? () => void w.deleteOne(p.id) : undefined,
  };
}

function statusCell(row: LineRowData, p: JobSource) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {row.status && <StatusWord status={row.status} />}
      <ProjectLockGlyph status={p.status} />
    </span>
  );
}

export function JobsList() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const now = useStableNow();
  const { state, setState } = useListUrlState(JOBS_SPEC);
  const perms: Perms = { update: useCanDo("project", "update"), create: useCanDo("project", "create"), remove: useCanDo("project", "delete") };

  const { items, total, isLoading, counts } = useJobsPage(orgId, now, jobsQueryArgs(state, now));
  const { issues, blocking } = useJobExtras(orgId, items);
  const clients = useClients(orgId);
  const [clientSearch, setClientSearch] = React.useState("");

  // Every job seen so far (phone pages accumulate): bulk and row handlers read the row at click time.
  const seen = React.useRef(new Map<string, JobSource>());
  React.useEffect(() => {
    for (const p of items) seen.current.set(p.id, p);
  }, [items]);

  const w = useJobListWrites(orgId, seen);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [tagIds, setTagIds] = React.useState<string[] | null>(null);

  const rows = items.map((p) => {
    const menu = buildJobActions({ title: p.name, status: p.status }, rowCtxFor(p, perms, w, setDialog));
    const row = jobRowOf(p, { issues: issues?.[p.id] ?? null, blocking: blocking?.[p.id] ?? 0 }, menu);
    return { ...row, cells: { status: statusCell(row, p) } };
  });

  const pageMenu = jobsPageMenu(state, setState, router.push);

  const goNew = () => router.push("/projects/new");
  const primary: ListPrimary | undefined = perms.create ? { label: "New job", onSelect: goNew } : undefined;
  const filters: ListFilterDef[] = jobFilters(
    (clients ?? []).map((c) => ({ id: c.id, name: c.name })),
    { value: clientSearch, onChange: setClientSearch },
  );

  return (
    <>
      <ListPage
        spec={JOBS_SPEC}
        title="Jobs"
        noun="job"
        bulkNoun="job"
        searchPlaceholder="Search name, job #, client or location"
        segments={jobSegments(counts as Record<string, number> | undefined)}
        filters={filters}
        views={[
          { key: "table", label: "Table" },
          { key: "board", label: "Board" },
        ]}
        columns={JOB_COLUMNS}
        rows={rows}
        total={total}
        loading={isLoading}
        itemHeader={JOB_ITEM_HEADER}
        itemSortKey={JOB_ITEM_SORT_KEY}
        primary={primary}
        pageMenu={pageMenu}
        bulk={(ids) => jobsBulk(ids, perms, w, setTagIds)}
        empty={{
          title: "No jobs yet",
          description: "Gigs, shows and events appear here from enquiry to invoice.",
          action: primary,
        }}
        toolbarExtra={
          <SavedViewsMenu
            tableId="projects"
            currentConfig={jobsViewConfig(state)}
            applyConfig={(c) => setState(jobsStateFromView(c))}
            onResetPreferences={() => setState(jobsStateFromView({}))}
          />
        }
        renderView={(view) => (view === "board" ? <ProjectBoard /> : null)}
      />
      <JobsDialogs w={w} dialog={dialog} setDialog={setDialog} tagIds={tagIds} setTagIds={setTagIds} />
    </>
  );
}

function JobsDialogs({
  w,
  dialog,
  setDialog,
  tagIds,
  setTagIds,
}: {
  w: ReturnType<typeof useJobListWrites>;
  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  tagIds: string[] | null;
  setTagIds: (ids: string[] | null) => void;
}) {
  return (
    <>
      <ConfirmStatusImpactDialog
        open={!!w.gate.pending}
        impact={w.gate.pending?.impact ?? null}
        pending={false}
        onConfirm={w.gate.confirmPending}
        onCancel={w.gate.cancelPending}
      />
      {dialog && (
        <DuplicateProjectDialog
          key={`${dialog.mode}-${dialog.project.id}`}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          sourceProject={dialog.project}
          mode={dialog.mode}
        />
      )}
      <TagPromptDialog
        open={tagIds !== null}
        onOpenChange={(open) => !open && setTagIds(null)}
        count={tagIds?.length ?? 0}
        noun="job"
        onSubmit={(tag) => tagIds && void w.bulkTag(tagIds, tag)}
      />
    </>
  );
}

/** The page ⋯: Show/Hide cancelled (the `show=cancelled` URL param), Templates, Overbookings. */
function jobsPageMenu(state: ListUrlState, setState: (s: ListUrlState) => void, push: (href: string) => void): ActionMenuSpec {
  const showCancelled = !!state.filters.show?.includes("cancelled");
  return {
    items: [
      {
        key: "show-cancelled",
        label: showCancelled ? "Hide cancelled" : "Show cancelled",
        group: "organise",
        icon: showCancelled ? EyeOff : Eye,
        onSelect: () => setState(setFilter(state, "show", showCancelled ? [] : ["cancelled"])),
      },
      { key: "templates", label: "Templates", group: "organise", icon: FileStack, onSelect: () => push("/projects/templates") },
      { key: "overbookings", label: "Overbookings", group: "reporting", icon: TriangleAlert, onSelect: () => push("/overbookings") },
    ],
  };
}

function jobsBulk(ids: string[], perms: Perms, w: ReturnType<typeof useJobListWrites>, setTagIds: (ids: string[]) => void) {
  return buildJobBulkActions({
    onSetStatus: perms.update ? (s) => void w.bulkStatus(ids, s) : undefined,
    onAddTag: perms.update ? () => setTagIds(ids) : undefined,
    onExport: () => w.bulkExport(ids),
    onCancel: perms.update ? () => void w.bulkCancel(ids) : undefined,
  });
}
