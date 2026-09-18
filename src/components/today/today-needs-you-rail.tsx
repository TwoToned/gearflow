"use client";

import Link from "next/link";
import { RefreshCw, Clock, Send, UserSearch } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { intentStyles } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import type { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type NeedsYouData = FunctionReturnType<typeof api.dashboardLists.needsYou>;
type CrewSignalRow = NeedsYouData["declinedCrew"][number];

/** `/crew/planner` deep link for "Find cover" (design §8.5) — pre-filters the
 *  planner to this assignment's role and free crew, on its own week. */
function findCoverHref(row: CrewSignalRow): string {
  const params = new URLSearchParams();
  if (row.crewRoleId) params.set("role", row.crewRoleId);
  params.set("avail", "AVAILABLE");
  if (row.startDate != null) params.set("week", String(row.startDate));
  const qs = params.toString();
  return `/crew/planner${qs ? `?${qs}` : ""}`;
}

function AsOfStamp({ asOf, onRefresh }: { asOf: number | undefined; onRefresh: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {asOf != null && (
        <span className="text-[10px] text-faint">as of {formatDistanceToNow(asOf, { addSuffix: true })}</span>
      )}
      <button
        type="button"
        aria-label="Refresh"
        onClick={onRefresh}
        className={cn("touch-target -m-2.5 flex items-center justify-center rounded-full text-muted hover:text-ink", focusRing)}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SnoozeButton({ sourceKey, onSnooze }: { sourceKey: string; onSnooze: (sourceKey: string) => void }) {
  return (
    <button
      type="button"
      title="Snooze until tomorrow"
      aria-label="Snooze until tomorrow"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSnooze(sourceKey);
      }}
      className={cn("touch-target -m-2 flex shrink-0 items-center justify-center rounded-full text-faint hover:text-ink", focusRing)}
    >
      <Clock className="h-3.5 w-3.5" />
    </button>
  );
}

/** One-key Re-offer (design §8.5) — calls the EXISTING offer flow
 *  (`sendCrewOffer`, `src/server/crew-communication.ts`) on this assignment;
 *  never a second, hand-rolled offer path. */
function ReofferButton({
  assignmentId,
  pending,
  onReoffer,
}: {
  assignmentId: string;
  pending: boolean;
  onReoffer: (assignmentId: string) => void;
}) {
  return (
    <button
      type="button"
      title="Re-offer this position"
      aria-label="Re-offer this position"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onReoffer(assignmentId);
      }}
      className={cn(
        "touch-target -m-2 flex shrink-0 items-center justify-center rounded-full text-faint hover:text-ink disabled:opacity-50",
        focusRing,
      )}
    >
      <Send className="h-3.5 w-3.5" />
    </button>
  );
}

/** Opens the planner filtered to eligible + available crew (design §8.5). */
function FindCoverLink({ row }: { row: CrewSignalRow }) {
  return (
    <Link
      href={findCoverHref(row)}
      title="Find cover"
      aria-label="Find cover"
      onClick={(e) => e.stopPropagation()}
      className={cn("touch-target -m-2 flex shrink-0 items-center justify-center rounded-full text-faint hover:text-ink", focusRing)}
    >
      <UserSearch className="h-3.5 w-3.5" />
    </Link>
  );
}

/** Today's "needs you" rail (work-layer.md §8.1) — crew declined/stale offers
 *  and quotes expiring soon, on projects the caller manages. One-shot; see
 *  dashboardLists.needsYou + useFocusPolledQuery. Snoozing a row (design doc
 *  §9: "Human can ... snooze") records the decision in workSignalStates and
 *  refreshes — the row disappears until the snooze expires. */
export function TodayNeedsYouRail({
  data,
  asOf,
  error,
  onRefresh,
  onSnooze,
  onReoffer,
  reofferingAssignmentId,
}: {
  data: NeedsYouData | undefined;
  asOf: number | undefined;
  error?: Error | null;
  onRefresh: () => void;
  onSnooze: (sourceKey: string) => void;
  onReoffer: (assignmentId: string) => void;
  reofferingAssignmentId?: string | null;
}) {
  const rowCount = data ? data.declinedCrew.length + data.staleOffers.length + data.expiringQuotes.length : 0;

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="t-overline text-muted">Needs you</h2>
        <AsOfStamp asOf={asOf} onRefresh={onRefresh} />
      </div>
      {data === undefined && error ? (
        <div className="flex items-center gap-2 border-l-2 border-l-t-out pl-2 py-1">
          <p className="flex-1 text-caption text-t-out">Couldn&apos;t load.</p>
          <button type="button" onClick={onRefresh} className="text-caption font-medium text-primary underline">
            Retry
          </button>
        </div>
      ) : data === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full rounded-[var(--r)]" />
          <Skeleton className="h-8 w-full rounded-[var(--r)]" />
        </div>
      ) : rowCount === 0 ? (
        <p className="text-caption text-muted">Nothing needs you.</p>
      ) : (
        <ul className="space-y-2">
          {data.declinedCrew.map((c) => (
            <li key={`declined-${c.assignmentId}`} className="flex items-start gap-1">
              <Link href={`/projects/${c.projectId}`} className={cn("flex flex-1 min-w-0 items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", intentStyles.error.dot)} aria-hidden />
                <p className="truncate text-[13px] text-ink-2 hover:underline">{c.crewMemberName} declined {c.projectName}</p>
              </Link>
              <ReofferButton assignmentId={c.assignmentId} pending={reofferingAssignmentId === c.assignmentId} onReoffer={onReoffer} />
              <FindCoverLink row={c} />
              <SnoozeButton sourceKey={c.sourceKey} onSnooze={onSnooze} />
            </li>
          ))}
          {data.staleOffers.map((c) => (
            <li key={`stale-${c.assignmentId}`} className="flex items-start gap-1">
              <Link href={`/projects/${c.projectId}`} className={cn("flex flex-1 min-w-0 items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", intentStyles.warning.dot)} aria-hidden />
                <p className="truncate text-[13px] text-ink-2 hover:underline">{c.crewMemberName} hasn&apos;t responded — {c.projectName}</p>
              </Link>
              <ReofferButton assignmentId={c.assignmentId} pending={reofferingAssignmentId === c.assignmentId} onReoffer={onReoffer} />
              <FindCoverLink row={c} />
              <SnoozeButton sourceKey={c.sourceKey} onSnooze={onSnooze} />
            </li>
          ))}
          {data.expiringQuotes.map((q) => (
            <li key={`quote-${q.quoteId}`} className="flex items-start gap-1">
              <Link href={`/projects/${q.projectId}`} className={cn("flex flex-1 min-w-0 items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", intentStyles.warning.dot)} aria-hidden />
                <p className="truncate text-[13px] text-ink-2 hover:underline">
                  Quote v{q.version} for {q.projectName} expires {q.daysLeft === 0 ? "today" : `in ${q.daysLeft}d`}
                </p>
              </Link>
              <SnoozeButton sourceKey={q.sourceKey} onSnooze={onSnooze} />
            </li>
          ))}
        </ul>
      )}
      {error && data !== undefined && (
        <p className="mt-2 text-[10px] text-t-out">Couldn&apos;t refresh — showing the last loaded data.</p>
      )}
    </div>
  );
}
