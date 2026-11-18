"use client";

/**
 * The toolbar line (spec 8, playbook 3.2): views and lanes are WORDS with the
 * active one underlined, never segmented controls; one `needs you` word reads
 * `3 short of crew · 4 to offer · 1 unanswered` and sets the Needs crew lane.
 * Phone: the same words scroll sideways under the search-less header.
 */
import { LANES, LANE_LABELS, type Lane } from "@/lib/logistics-model";
import { cn } from "@/lib/utils";

export type LogisticsView = "timeline" | "people";

const VIEW_LABELS: Record<LogisticsView, string> = { timeline: "Timeline", people: "By person" };

function Word({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap px-1 text-ui-text outline-none focus-visible:ring-2 focus-visible:ring-red",
        active ? "font-medium text-ink underline decoration-red decoration-2 underline-offset-[6px]" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function LaneBar({
  view, onView, lane, onLane, needs, trailing,
}: {
  view: LogisticsView;
  onView: (v: LogisticsView) => void;
  lane: Lane;
  onLane: (l: Lane) => void;
  needs: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-1">
      <div role="group" aria-label="View" className="flex items-center gap-3">
        {(Object.keys(VIEW_LABELS) as LogisticsView[]).map((v) => (
          <Word key={v} active={view === v} onClick={() => onView(v)}>{VIEW_LABELS[v]}</Word>
        ))}
      </div>
      {view === "timeline" && (
        <div role="group" aria-label="Lane" className="flex items-center gap-3 overflow-x-auto">
          {LANES.map((l) => (
            <Word key={l} active={lane === l} onClick={() => onLane(l)}>{LANE_LABELS[l]}</Word>
          ))}
        </div>
      )}
      {needs ? (
        <button type="button" onClick={() => onLane("needs")} className="text-caption font-medium text-t-out hover:underline">
          {needs}
        </button>
      ) : (
        <span className="text-caption text-ok">Crew sorted</span>
      )}
      <div className="ml-auto flex items-center gap-2">{trailing}</div>
    </div>
  );
}
