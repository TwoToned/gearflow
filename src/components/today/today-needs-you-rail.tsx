"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { intentStyles } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import type { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

type NeedsYouData = FunctionReturnType<typeof api.dashboardLists.needsYou>;

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

/** Today's "needs you" rail (work-layer.md §8.1) — crew declined/stale offers
 *  and quotes expiring soon, on projects the caller manages. One-shot; see
 *  dashboardLists.needsYou + useFocusPolledQuery. */
export function TodayNeedsYouRail({
  data,
  asOf,
  onRefresh,
}: {
  data: NeedsYouData | undefined;
  asOf: number | undefined;
  onRefresh: () => void;
}) {
  const rowCount = data ? data.declinedCrew.length + data.staleOffers.length + data.expiringQuotes.length : 0;

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="t-overline text-muted">Needs you</h2>
        <AsOfStamp asOf={asOf} onRefresh={onRefresh} />
      </div>
      {data === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full rounded-[var(--r)]" />
          <Skeleton className="h-8 w-full rounded-[var(--r)]" />
        </div>
      ) : rowCount === 0 ? (
        <p className="text-caption text-muted">Nothing needs you.</p>
      ) : (
        <ul className="space-y-2">
          {data.declinedCrew.map((c) => (
            <li key={`declined-${c.assignmentId}`}>
              <Link href={`/projects/${c.projectId}`} className={cn("flex items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", intentStyles.error.dot)} aria-hidden />
                <p className="truncate text-[13px] text-ink-2 hover:underline">{c.crewMemberName} declined {c.projectName}</p>
              </Link>
            </li>
          ))}
          {data.staleOffers.map((c) => (
            <li key={`stale-${c.assignmentId}`}>
              <Link href={`/projects/${c.projectId}`} className={cn("flex items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", intentStyles.warning.dot)} aria-hidden />
                <p className="truncate text-[13px] text-ink-2 hover:underline">{c.crewMemberName} hasn&apos;t responded — {c.projectName}</p>
              </Link>
            </li>
          ))}
          {data.expiringQuotes.map((q) => (
            <li key={`quote-${q.quoteId}`}>
              <Link href={`/projects/${q.projectId}`} className={cn("flex items-start gap-2 rounded-[var(--r)] -mx-1 px-1 py-0.5", focusRing)}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", intentStyles.warning.dot)} aria-hidden />
                <p className="truncate text-[13px] text-ink-2 hover:underline">
                  Quote v{q.version} for {q.projectName} expires {q.daysLeft === 0 ? "today" : `in ${q.daysLeft}d`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
