"use client";

import { useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/card";
import { intentStyles } from "@/lib/status-colors";
import { TIMELINE_FILTERS, TIMELINE_FILTER_LABELS, TIMELINE_CATEGORY_INTENT, matchesTimelineFilter, type TimelineFilter } from "@/lib/client-timeline";
import { cn, focusRing } from "@/lib/utils";

export type ClientTimelineData = FunctionReturnType<typeof api.clientTimeline.forClient>;

function formatWhen(at: number) {
  return new Date(at).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Client timeline tab (#1245, design §8.4) — the unified stream of quote/
 *  invoice/job events, comments and mentions, logged calls/emails/notes, and
 *  work done. `convex/clientTimeline.ts`'s `forClient` does the union; this
 *  component is presentation + client-side filtering only — the query is
 *  owned by the client detail page so the "since last touch" hero stat and
 *  this tab share ONE subscription rather than two independently-timed ones. */
export function ClientTimelineTab({ data }: { data: ClientTimelineData | undefined }) {
  const [filter, setFilter] = useState<TimelineFilter>("all");

  const rows = data?.rows.filter((r) => matchesTimelineFilter(r.category, filter)) ?? [];

  return (
    <Panel padding="responsive">
      <div className="mb-4 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filter timeline">
        {TIMELINE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-caption font-medium transition-colors",
              focusRing,
              filter === f
                ? "border-ink bg-ink text-paper"
                : "border-line text-muted hover:border-ink-2 hover:text-ink-2",
            )}
          >
            {TIMELINE_FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {data === undefined ? (
        <p className="text-caption text-muted">Loading timeline…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "Nothing here yet" : `No ${TIMELINE_FILTER_LABELS[filter].toLowerCase()} touches yet`}
          description="Quotes, invoices, comments and anything you log will show up here."
        />
      ) : (
        <ol className="space-y-3">
          {rows.map((row) => {
            const intent = intentStyles[TIMELINE_CATEGORY_INTENT[row.category]];
            return (
              <li key={row.id} className="flex gap-3">
                <div className="flex flex-col items-center pt-1.5">
                  <span className={cn("size-2 shrink-0 rounded-full", intent.dot)} aria-hidden />
                </div>
                <div className="min-w-0 flex-1 border-b border-line pb-3 last:border-0 last:pb-0">
                  <p className="text-[13.5px] text-ink-2">{row.summary}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
                    <span>{formatWhen(row.at)}</span>
                    {row.actorName && (
                      <>
                        <span aria-hidden>&middot;</span>
                        <span>{row.actorName}</span>
                      </>
                    )}
                    {row.projectId && row.projectNumber && (
                      <>
                        <span aria-hidden>&middot;</span>
                        <Link href={`/projects/${row.projectId}`} className={cn("rounded-sm t-mono hover:text-ink hover:underline", focusRing)}>
                          {row.projectNumber}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {data && data.capped && (
        <p className="mt-3 text-caption text-faint">Showing the {data.rows.length} most recent of {data.total} touches.</p>
      )}
    </Panel>
  );
}
