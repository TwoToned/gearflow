"use client";

/**
 * The desktop timeline: one list per day under a day header (`Tue 11 Nov ·
 * load in`, with that day's counts). Rows are the one `LineRow`; crew expand
 * under their service. The columns are fixed-layout so the lists line up
 * across days; only the first list prints a header row (spec 8 narrower-desktop
 * note: six columns, nothing wraps per word).
 */
import { LineRowList } from "@/components/ui/line-row";
import { dayLabel, filledOf, crewShort, type DayGroup } from "@/lib/logistics-model";
import type { FactColumn, LineRowData, RowSelection } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";
import { TransportStopRow } from "./transport-stop-row";

function dayNote(key: string, loadIn: string, loadOut: string): string {
  if (key && key === loadIn && key === loadOut) return "load in and out";
  if (key && key === loadIn) return "load in";
  if (key && key === loadOut) return "load out";
  return "";
}

function DayHeader({ group, note }: { group: DayGroup; note: string }) {
  const live = group.services.filter((s) => s.status !== "CANCELLED");
  const crew = live.reduce((n, s) => n + filledOf(s).length, 0);
  const needed = live.reduce((n, s) => n + crewShort(s), 0);
  const stops = group.stops?.length ?? 0;
  const counts = [
    live.length > 0 || stops === 0 ? live.length + (live.length === 1 ? " service" : " services") : "",
    crew ? crew + " crew" : "",
    stops ? stops + (stops === 1 ? " sub-hire stop" : " sub-hire stops") : "",
  ].filter(Boolean);
  return (
    <div className="mt-4 flex items-baseline gap-3 first:mt-1">
      <h3 className="t-overline text-ink">
        {dayLabel(group.key)}
        {note && <span className="font-normal text-muted">{" · " + note}</span>}
      </h3>
      <span className="t-mono text-caption text-muted">{counts.join(" · ")}</span>
      {needed > 0 && <span className="text-caption font-medium text-t-out">{needed + " needed"}</span>}
    </div>
  );
}

export function Timeline({
  groups, rowFor, columns, selection, loadInDay, loadOutDay, onOpenOrder,
}: {
  onOpenOrder: (subHireId: string) => void;
  groups: DayGroup[];
  rowFor: (id: string) => LineRowData;
  columns: FactColumn[];
  selection: RowSelection;
  loadInDay: string;
  loadOutDay: string;
}) {
  return (
    <div>
      {groups.map((g, i) => (
        <section key={g.key || "unscheduled"} aria-label={dayLabel(g.key)}>
          <DayHeader group={g} note={dayNote(g.key, loadInDay, loadOutDay)} />
          {g.services.length > 0 && (
            <LineRowList
              rows={g.services.map((s) => rowFor(s.id))}
              columns={columns}
              selection={selection}
              className={cn(
                "table-fixed",
                "[&_td:nth-child(3)]:w-28 [&_td:nth-child(4)]:w-28 [&_td:nth-child(5)]:w-24",
                i > 0 && "[&_thead]:hidden",
              )}
            />
          )}
          {g.stops?.map((st) => <TransportStopRow key={st.id} stop={st} onOpen={onOpenOrder} />)}
        </section>
      ))}
    </div>
  );
}
