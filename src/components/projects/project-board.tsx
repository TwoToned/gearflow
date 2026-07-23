"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, ShieldAlert } from "lucide-react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "../../../convex/_generated/api";
import { useServerQuery } from "@/hooks/use-server-query";
import { getProjectIssueFlags } from "@/server/projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn, focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { CanDo } from "@/components/auth/permission-gate";
import { Skeleton } from "@/components/ui/skeleton";
import { FlowMascot } from "@/components/ui/flow-mascot";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";

// Lifecycle stages → columns. Each stage carries a module hue for its header.
type Hue = "rep" | "blue" | "ok" | "warn" | "red";
const STAGES: { key: string; label: string; statuses: string[]; hue: Hue; live?: boolean }[] = [
  { key: "enquiry", label: "Enquiry", statuses: ["ENQUIRY"], hue: "rep" },
  { key: "quote", label: "Quote", statuses: ["QUOTING", "QUOTED"], hue: "blue" },
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

export function ProjectBoard() {
  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // ONE server-side query (filter + search + client join all done in Convex)
  // instead of the 2 whole-org live subscriptions this used to mount
  // (projects/clients) and join/filter client-side. See docs/designs/
  // perf-convex-efficiency-2026-06.md Finding #1 ("Option A" — the board is
  // an unpaginated "browse everything, grouped by stage" view, same shape as
  // the asset gallery). Search is debounced since each keystroke is now a
  // real round-trip.
  const debouncedSearch = useDebouncedValue(search, 200);
  const visible = useAuthedQuery(
    api.projects.listBoard,
    orgId ? { orgId, search: debouncedSearch.trim() || undefined } : "skip",
  );

  const ids = useMemo(() => (visible ?? []).map((p) => p.id), [visible]);
  const { data: issueFlags } = useServerQuery({
    queryKey: ["project-issues-board", ids],
    queryFn: () => getProjectIssueFlags(ids),
    enabled: ids.length > 0,
  });
  const blockingCounts = useAuthedQuery(
    api.collaboration.listBlockingForProjects,
    orgId && ids.length > 0 ? { orgId, projectIds: ids } : "skip",
  ) as Record<string, number> | undefined;

  const byStage = useMemo(() => {
    const m = new Map<string, AnyProject[]>();
    for (const s of STAGES) m.set(s.key, []);
    for (const p of visible ?? []) {
      const stage = STAGES.find((s) => s.statuses.includes(p.status as string));
      if (stage) m.get(stage.key)!.push(p);
    }
    return m;
  }, [visible]);

  const isLoading = visible === undefined;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xs flex-1">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs by name, # or client…"
          />
        </div>
        <CanDo resource="project" action="create">
          <Button asChild variant="halo"><Link href="/projects/new"><Plus className="h-4 w-4" /> New job</Link></Button>
        </CanDo>
      </div>

      {/* board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto">
          {STAGES.slice(0, 5).map((s) => (
            <div key={s.key} className="w-72 shrink-0 space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24 w-full rounded-[var(--r-lg)]" />
              <Skeleton className="h-24 w-full rounded-[var(--r-lg)]" />
            </div>
          ))}
        </div>
      ) : ids.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border border-dashed border-line py-16 text-center">
          <FlowMascot className="h-12 w-12" />
          <p className="text-[15px] font-medium text-ink">{search ? "No jobs match that." : "No jobs yet."}</p>
          <p className="t-micro text-muted">{search ? "Try a looser search." : "Create one before the calendar starts lying."}</p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((stage) => {
            const items = byStage.get(stage.key) ?? [];
            return (
              <div key={stage.key} className="flex w-72 shrink-0 flex-col">
                {/* column header */}
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={cn("size-2 rounded-full", hueDot[stage.hue])} aria-hidden />
                  <span className="text-table-cell font-semibold text-ink">{stage.label}</span>
                  <span className="t-micro text-muted">{items.length}</span>
                  {stage.live && items.length > 0 && (
                    <span className="relative ml-auto flex h-2 w-2" aria-hidden>
                      <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-ok opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
                    </span>
                  )}
                </div>
                {/* cards */}
                <div className="flex flex-col gap-2">
                  {items.length === 0 ? (
                    <div className="rounded-[var(--r-lg)] border border-dashed border-line/60 py-6 text-center">
                      <p className="t-micro text-faint">Empty</p>
                    </div>
                  ) : (
                    items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        hue={stage.hue}
                        live={!!stage.live}
                        issues={issueFlags?.[p.id] ?? null}
                        blocking={blockingCounts?.[p.id] ?? 0}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, hue, live, issues, blocking }: { project: AnyProject; hue: Hue; live: boolean; issues: { hasOverbooked: boolean; hasReducedStock: boolean } | null; blocking: number }) {
  const client = project.client as { name?: string } | null;
  const dl = dateLine(project);
  const total = project.total != null ? `$${Number(project.total).toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : null;
  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        "group block rounded-[var(--r-lg)] border bg-card p-3 shadow-[var(--sh-card)] transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--sh-hover)]",
        focusRing,
        blocking > 0 ? "border-t-out/40" : "border-line",
        live && "shadow-[var(--sh-card),var(--lit)] bg-elev",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[14px] font-semibold text-ink">{project.name}</p>
        <div className="flex shrink-0 items-center gap-1">
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
    </Link>
  );
}
