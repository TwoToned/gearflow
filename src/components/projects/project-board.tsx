"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, ShieldAlert } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "../../../convex/_generated/api";
import { useServerQuery } from "@/hooks/use-server-query";
import { getProjectIssueFlags } from "@/server/projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useConfirmStatusGate } from "@/hooks/use-confirm-status-gate";
import { ConfirmStatusImpactDialog } from "@/components/projects/confirm-status-impact-dialog";
import { cn, focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { CanDo } from "@/components/auth/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { ProjectLockGlyph } from "@/components/projects/project-lock-glyph";
import { toast } from "sonner";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";

// Lifecycle stages → columns. Each stage carries a module hue for its header.
type Hue = "rep" | "blue" | "ok" | "warn" | "red";
const STAGES: { key: string; label: string; statuses: string[]; hue: Hue; live?: boolean }[] = [
  { key: "enquiry", label: "Enquiry", statuses: ["ENQUIRY"], hue: "rep" },
  { key: "quote", label: "Quote", statuses: ["QUOTING", "QUOTED"], hue: "blue" },
  // #1236 — "waiting on money" is the column most worth seeing each morning.
  { key: "payment", label: "Awaiting payment", statuses: ["AWAITING_PAYMENT"], hue: "warn" },
  { key: "confirmed", label: "Confirmed", statuses: ["CONFIRMED"], hue: "ok" },
  { key: "prep", label: "Prep", statuses: ["PREPPING"], hue: "warn" },
  { key: "out", label: "Out / on site", statuses: ["CHECKED_OUT", "ON_SITE"], hue: "red", live: true },
  { key: "returned", label: "Returned", statuses: ["RETURNED"], hue: "rep" },
  { key: "done", label: "Done", statuses: ["COMPLETED", "INVOICED"], hue: "ok" },
];

const hueDot: Record<Hue, string> = { rep: "bg-rep", blue: "bg-blue", ok: "bg-ok", warn: "bg-warn", red: "bg-red" };
const hueText: Record<Hue, string> = { rep: "text-rep", blue: "text-blue", ok: "text-ok", warn: "text-warn", red: "text-red" };

const typeLabels: Record<string, string> = {
  DRY_HIRE: "Dry hire", WET_HIRE: "Wet hire", INSTALLATION: "Install", TOUR: "Tour",
  CORPORATE: "Corporate", THEATRE: "Theatre", FESTIVAL: "Festival", CONFERENCE: "Conference", OTHER: "Other",
};

const DAY = 24 * 60 * 60 * 1000;
// Design §8.4/§8.3 — "quoted cards show rotting" (a simple days-since-touch
// tint; full per-client rotting thresholds are a later phase, see §8.4).
const ROT_AMBER_DAYS = 3;
const ROT_RED_DAYS = 7;
const ROTTING_STATUSES = new Set(["QUOTING", "QUOTED"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProject = Record<string, any>;

function dateLine(p: AnyProject): { text: string; tone: "error" | "warning" | "muted" } | null {
  const now = Date.now();
  const start = p.rentalStartDate as number | null;
  const end = p.rentalEndDate as number | null;
  const out = p.status === "CHECKED_OUT" || p.status === "ON_SITE";
  const fmt = (d: number) => new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  if (out && end) {
    const days = Math.round((end - now) / DAY);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "error" };
    if (days === 0) return { text: "Back today", tone: "warning" };
    if (days <= 3) return { text: `Back in ${days}d`, tone: "warning" };
    return { text: `Back ${fmt(end)}`, tone: "muted" };
  }
  if (start) {
    const days = Math.round((start - now) / DAY);
    if (days < 0) return { text: `Started ${fmt(start)}`, tone: "muted" };
    if (days === 0) return { text: "Starts today", tone: "warning" };
    if (days <= 7) return { text: `Starts in ${days}d`, tone: days <= 2 ? "warning" : "muted" };
    return { text: `Starts ${fmt(start)}`, tone: "muted" };
  }
  return null;
}
const toneText = { error: "text-t-out", warning: "text-warn", muted: "text-muted" } as const;

export function rotTint(p: AnyProject, now: number): "amber" | "red" | null {
  if (!ROTTING_STATUSES.has(p.status as string)) return null;
  const touchedAt = (p.updatedAt as number | undefined) ?? (p.createdAt as number | undefined);
  if (!touchedAt) return null;
  const days = (now - touchedAt) / DAY;
  if (days >= ROT_RED_DAYS) return "red";
  if (days >= ROT_AMBER_DAYS) return "amber";
  return null;
}

function stageKeyOf(status: string | null | undefined): string | null {
  return STAGES.find((s) => s.statuses.includes(status as string))?.key ?? null;
}

interface BoardDropPlan {
  projectId: string;
  currentStatus: string;
  nextStatus: string;
}

/** What a drag-drop on the board means: a target STAGE column resolves to
 *  the FIRST status in that column (the natural "advance into this stage"
 *  target for a multi-status column, e.g. Quote = QUOTING/QUOTED). Returns
 *  `null` for every no-op shape (no drop target, same column, unknown
 *  project/stage) so `handleDragEnd` stays a thin dispatcher (R-3.6). Pure
 *  — unit-testable without mounting dnd-kit. */
export function resolveBoardDrop(e: DragEndEvent, projectById: Map<string, AnyProject>): BoardDropPlan | null {
  const { active, over } = e;
  if (!over) return null;
  const projectId = String(active.id);
  const project = projectById.get(projectId);
  if (!project) return null;
  const currentStageKey = stageKeyOf(project.status as string);
  const targetStageKey = String(over.id);
  if (!currentStageKey || targetStageKey === currentStageKey) return null;
  const targetStage = STAGES.find((s) => s.key === targetStageKey);
  if (!targetStage) return null;
  return { projectId, currentStatus: project.status as string, nextStatus: targetStage.statuses[0] };
}

export function ProjectBoard() {
  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [now] = useState(() => Date.now());

  // ONE server-side query (filter + search + client join all done in Convex)
  // instead of the 2 whole-org live subscriptions this used to mount
  // (projects/clients) and join/filter client-side. See docs/designs/
  // perf-convex-efficiency-2026-06.md Finding #1 ("Option A" — the board is
  // an unpaginated "browse everything, grouped by stage" view, same shape as
  // the asset gallery). Search is debounced since each keystroke is now a
  // real round-trip.
  const debouncedSearch = useDebouncedValue(search, 200);
  // Each conditional-args expression lives in its own `useMemo` callback —
  // a separate function scope for ESLint's `complexity` rule — rather than
  // as an inline ternary directly in ProjectBoard's own body (R-3.6: keeps
  // this function's own branch count down without changing behavior).
  const listBoardArgs = useMemo(
    () => (orgId ? { orgId, search: debouncedSearch.trim() || undefined } : ("skip" as const)),
    [orgId, debouncedSearch],
  );
  const visible = useAuthedQuery(api.projects.listBoard, listBoardArgs);

  const ids = useMemo(() => (visible ?? []).map((p) => p.id), [visible]);
  const { data: issueFlags } = useServerQuery({
    queryKey: ["project-issues-board", ids],
    queryFn: () => getProjectIssueFlags(ids),
    enabled: ids.length > 0,
  });
  const blockingArgs = useMemo(
    () => (orgId && ids.length > 0 ? { orgId, projectIds: ids } : ("skip" as const)),
    [orgId, ids],
  );
  const blockingCounts = useAuthedQuery(api.collaboration.listBlockingForProjects, blockingArgs) as
    | Record<string, number>
    | undefined;
  // #1244 — "9/14 work · 1 overdue" per card. Batched over every visible
  // project id, bounded per-project (see workCountsForProjects's own
  // comment on why this isn't an org-wide collect).
  const workCountsArgs = useMemo(
    () => (orgId && ids.length > 0 ? { orgId, projectIds: ids, now } : ("skip" as const)),
    [orgId, ids, now],
  );
  const workCounts = useAuthedQuery(api.projectTasks.workCountsForProjects, workCountsArgs) as
    | Record<string, { done: number; total: number; overdue: number }>
    | undefined;

  const byStage = useMemo(() => {
    const m = new Map<string, AnyProject[]>();
    for (const s of STAGES) m.set(s.key, []);
    for (const p of visible ?? []) {
      const stage = STAGES.find((s) => s.statuses.includes(p.status as string));
      if (stage) m.get(stage.key)!.push(p);
    }
    return m;
  }, [visible]);

  const projectById = useMemo(() => new Map((visible ?? []).map((p) => [p.id, p])), [visible]);

  // #1244 — drag-to-advance. A drop calls the EXISTING status-change
  // mutation (`updateStatusNative` via `useNativeProjectStatus`), so
  // lifecycle locks (the confirmed-with-no-accepted-quote gate) and the
  // confirm-impact preview dialog apply exactly as the stepper's do — never
  // a bypass. Dropping on the SAME column is a no-op (this board doesn't
  // track a manual within-column order).
  const statusWrites = useNativeProjectStatus(orgId);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const confirmGate = useConfirmStatusGate(orgId, (projectId, nextStatus) => {
    setAdvancing(projectId);
    statusWrites
      .updateStatus(projectId, nextStatus)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not update status"))
      .finally(() => setAdvancing(null));
  });
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } });
  const keyboardSensor = useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const plan = resolveBoardDrop(e, projectById);
    if (!plan) return;
    confirmGate.requestStatusChange(plan.projectId, plan.currentStatus, plan.nextStatus);
  }

  const isLoading = visible === undefined;
  const activeProject = useMemo(
    () => (activeDragId ? projectById.get(activeDragId) ?? null : null),
    [activeDragId, projectById],
  );

  return (
    <div className="space-y-4">
      <BoardToolbar search={search} onSearchChange={setSearch} />
      <BoardBody
        isLoading={isLoading}
        search={search}
        idsCount={ids.length}
        byStage={byStage}
        issueFlags={issueFlags}
        blockingCounts={blockingCounts}
        workCounts={workCounts}
        now={now}
        advancing={advancing}
        confirmChecking={confirmGate.checking}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        activeProject={activeProject}
      />
      <ConfirmStatusImpactDialog
        open={!!confirmGate.pending}
        impact={confirmGate.pending?.impact ?? null}
        pending={advancing !== null}
        onConfirm={confirmGate.confirmPending}
        onCancel={confirmGate.cancelPending}
      />
    </div>
  );
}

/** Split out of ProjectBoard (R-3.6). */
function BoardToolbar({ search, onSearchChange }: { search: string; onSearchChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="max-w-xs flex-1">
        <SearchInput
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search jobs by name, # or client…"
        />
      </div>
      <CanDo resource="project" action="create">
        <Button asChild variant="halo"><Link href="/projects/new"><Plus className="h-4 w-4" /> New job</Link></Button>
      </CanDo>
    </div>
  );
}

function BoardLoadingSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto">
      {STAGES.slice(0, 5).map((s) => (
        <div key={s.key} className="w-72 shrink-0 space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full rounded-[var(--r-lg)]" />
          <Skeleton className="h-24 w-full rounded-[var(--r-lg)]" />
        </div>
      ))}
    </div>
  );
}

function BoardEmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border border-dashed border-line py-16 text-center">
      <FlowMascot className="h-12 w-12" />
      <p className="text-[15px] font-medium text-ink">{search ? "No jobs match that." : "No jobs yet."}</p>
      <p className="t-micro text-muted">{search ? "Try a looser search." : "Create one before the calendar starts lying."}</p>
    </div>
  );
}

/** Split out of ProjectBoard (R-3.6) — the loading/empty/board tri-state and
 *  the DndContext + drag overlay. */
function BoardBody({
  isLoading,
  search,
  idsCount,
  byStage,
  issueFlags,
  blockingCounts,
  workCounts,
  now,
  advancing,
  confirmChecking,
  sensors,
  onDragStart,
  onDragEnd,
  activeProject,
}: {
  isLoading: boolean;
  search: string;
  idsCount: number;
  byStage: Map<string, AnyProject[]>;
  issueFlags: Record<string, { hasOverbooked: boolean; hasReducedStock: boolean }> | undefined;
  blockingCounts: Record<string, number> | undefined;
  workCounts: Record<string, { done: number; total: number; overdue: number }> | undefined;
  now: number;
  advancing: string | null;
  confirmChecking: boolean;
  sensors: Parameters<typeof DndContext>[0]["sensors"];
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  activeProject: AnyProject | null;
}) {
  if (isLoading) return <BoardLoadingSkeleton />;
  if (idsCount === 0) return <BoardEmptyState search={search} />;
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <BoardColumnsGrid
        byStage={byStage}
        issueFlags={issueFlags}
        blockingCounts={blockingCounts}
        workCounts={workCounts}
        now={now}
        advancing={advancing}
        confirmChecking={confirmChecking}
      />
      <DragOverlay>
        {activeProject && (
          <ProjectCard
            project={activeProject}
            hue={hueForStatus(activeProject.status as string)}
            live={false}
            issues={null}
            blocking={0}
            work={workCounts?.[activeProject.id] ?? null}
            rot={rotTint(activeProject, now)}
            advancing={false}
            overlay
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function hueForStatus(status: string): Hue {
  return STAGES.find((s) => s.statuses.includes(status))?.hue ?? "rep";
}

/** Split out of ProjectBoard (R-3.6) purely to keep that function's own
 *  complexity down — the STAGES × items double-map that draws every column
 *  and card. */
function BoardColumnsGrid({
  byStage,
  issueFlags,
  blockingCounts,
  workCounts,
  now,
  advancing,
  confirmChecking,
}: {
  byStage: Map<string, AnyProject[]>;
  issueFlags: Record<string, { hasOverbooked: boolean; hasReducedStock: boolean }> | undefined;
  blockingCounts: Record<string, number> | undefined;
  workCounts: Record<string, { done: number; total: number; overdue: number }> | undefined;
  now: number;
  advancing: string | null;
  confirmChecking: boolean;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STAGES.map((stage) => (
        <BoardColumn key={stage.key} stageKey={stage.key}>
          <BoardColumnHeader stage={stage} count={(byStage.get(stage.key) ?? []).length} />
          <div className="flex flex-col gap-2">
            {(byStage.get(stage.key) ?? []).length === 0 ? (
              <div className="rounded-[var(--r-lg)] border border-dashed border-line/60 py-6 text-center">
                <p className="t-micro text-faint">Empty</p>
              </div>
            ) : (
              (byStage.get(stage.key) ?? []).map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  hue={stage.hue}
                  live={!!stage.live}
                  issues={issueFlags?.[p.id] ?? null}
                  blocking={blockingCounts?.[p.id] ?? 0}
                  work={workCounts?.[p.id] ?? null}
                  rot={rotTint(p, now)}
                  advancing={advancing === p.id || confirmChecking}
                />
              ))
            )}
          </div>
        </BoardColumn>
      ))}
    </div>
  );
}

function BoardColumnHeader({ stage, count }: { stage: (typeof STAGES)[number]; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className={cn("size-2 rounded-full", hueDot[stage.hue])} aria-hidden />
      <span className="text-table-cell font-semibold text-ink">{stage.label}</span>
      <span className="t-micro text-muted">{count}</span>
      {stage.live && count > 0 && (
        <span className="relative ml-auto flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-ok opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
        </span>
      )}
    </div>
  );
}

function BoardColumn({ stageKey, children }: { stageKey: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });
  return (
    <div ref={setNodeRef} className={cn("flex w-72 shrink-0 flex-col rounded-[var(--r-lg)] p-1 transition-colors", isOver && "bg-select/40")}>
      {children}
    </div>
  );
}

function ProjectCard({
  project,
  hue,
  live,
  issues,
  blocking,
  work,
  rot,
  advancing,
  overlay,
}: {
  project: AnyProject;
  hue: Hue;
  live: boolean;
  issues: { hasOverbooked: boolean; hasReducedStock: boolean } | null;
  blocking: number;
  work: { done: number; total: number; overdue: number } | null;
  rot: "amber" | "red" | null;
  advancing: boolean;
  overlay?: boolean;
}) {
  // Destructured immediately (never kept as a `draggable.foo` member
  // access later) — matches the established dnd-kit pattern in
  // equipment-tab.tsx's per-row `useSortable()` calls, which avoids
  // `react-hooks/refs` heuristically flagging property reads off a
  // hook-returned object as a ref access during render.
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: project.id, disabled: overlay });
  const client = project.client as { name?: string } | null;
  const dl = dateLine(project);
  const total = project.total != null ? `$${Number(project.total).toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : null;

  const cardBody = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[14px] font-semibold text-ink">{project.name}</p>
        <div className="flex shrink-0 items-center gap-1">
          <ProjectLockGlyph status={project.status as string | null | undefined} />
          {issues && (issues.hasOverbooked || issues.hasReducedStock) && (
            <TooltipProvider><Tooltip>
              <TooltipTrigger className={cn("rounded-full", focusRing, issues.hasOverbooked ? "text-t-out" : "text-blue")}><AlertTriangle className="h-3.5 w-3.5" /></TooltipTrigger>
              <TooltipContent>{issues.hasOverbooked ? "Overbooked items" : "Reduced stock"}</TooltipContent>
            </Tooltip></TooltipProvider>
          )}
          {blocking > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-out-soft px-1.5 py-0.5 text-[11px] font-medium text-t-out">
              <ShieldAlert className="h-3 w-3" />{blocking}
            </span>
          )}
        </div>
      </div>
      <p className="t-micro truncate text-muted">
        <span className="font-mono">{project.projectNumber}</span>
        {client?.name ? <> · {client.name}</> : null}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {dl ? <span className={cn("text-[11px] font-medium", toneText[dl.tone])}>{dl.text}</span> : <span className="t-micro text-faint">No dates</span>}
        <div className="flex items-center gap-1.5">
          {project.type && <span className="rounded-full border border-line px-1.5 py-0.5 text-[11px] text-muted">{typeLabels[project.type] || project.type}</span>}
          {total && <span className={cn("text-[11px] font-semibold tabular-nums", hueText[hue])}>{total}</span>}
        </div>
      </div>
      {work && work.total > 0 && (
        <p className="mt-1.5 t-micro text-muted">
          {work.done}/{work.total} work{work.overdue > 0 ? <span className="text-t-out"> · {work.overdue} overdue</span> : null}
        </p>
      )}
    </>
  );

  if (overlay) {
    return (
      <div className={cn("block rounded-[var(--r-lg)] border bg-card p-3 shadow-[var(--sh-hover)]", "border-line")}>
        {cardBody}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "relative touch-none",
        isDragging && "opacity-40",
        advancing && "pointer-events-none opacity-60",
      )}
    >
      <Link
        href={`/projects/${project.id}`}
        onClickCapture={(e) => {
          // A drag gesture (delay-based PointerSensor) can still leave a
          // trailing click on release — swallow it so a drag never
          // double-fires as a navigation.
          if (isDragging) e.preventDefault();
        }}
        className={cn(
          "group block rounded-[var(--r-lg)] border bg-card p-3 shadow-[var(--sh-card)] transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--sh-hover)]",
          focusRing,
          blocking > 0 ? "border-t-out/40" : "border-line",
          live && "shadow-[var(--sh-card),var(--lit)] bg-elev",
          rot === "amber" && "bg-warn-soft/40",
          rot === "red" && "bg-out-soft/40",
        )}
      >
        {cardBody}
      </Link>
    </div>
  );
}
