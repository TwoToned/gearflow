"use client";

/**
 * Phone day mode (spec 8, D4): the same services as the desktop timeline, one
 * day at a time. Day chips (a red count where crew are needed), then cards
 * with the call time in mono, status, where + Directions, the note, crew
 * avatars ringed by status; tap a card to edit. The day's crew list sits
 * beneath. This REPLACES the old `/runsheet` page: one rendering of one data
 * set, and there is no read-only fork of it.
 */
import { PersonAvatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionMenu } from "@/components/ui/action-menu";
import { StatusWord } from "@/components/ui/status-word";
import {
  crewShort, dayShortLabel, filledOf, whenText,
  type DayGroup, type LogisticsService,
} from "@/lib/logistics-model";
import type { ActionMenuSpec, RowSelection } from "@/lib/primitives/types";
import { getStatusIntent, intentStyles } from "@/lib/status-colors";
import { assignmentStatusLabels } from "@/lib/status-labels";
import { cn } from "@/lib/utils";
import { crewText, personName, serviceStatusValue, whereLine } from "./service-rows";
import { TransportStopRow } from "./transport-stop-row";

export function directionsHref(s: LogisticsService): string | null {
  if (s.latitude == null || s.longitude == null) return null;
  return "https://www.google.com/maps/dir/?api=1&destination=" + s.latitude + "," + s.longitude;
}

function DayChip({ group, active, onClick }: { group: DayGroup; active: boolean; onClick: () => void }) {
  const need = group.services.reduce((n, s) => n + crewShort(s), 0);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-ui-text",
        active ? "font-medium text-ink underline decoration-red decoration-2 underline-offset-[6px]" : "text-muted",
      )}
    >
      {group.key ? dayShortLabel(group.key) : "TBC"}
      {need > 0 && <span className="t-mono text-caption font-medium text-t-out">{need}</span>}
    </button>
  );
}

function CrewStack({ s }: { s: LogisticsService }) {
  const people = filledOf(s);
  if (people.length === 0 && !s.crewCountRequired) return null;
  const short = crewShort(s);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="flex -space-x-1">
        {people.map((a) => (
          <span
            key={a.id}
            title={personName(a) + " · " + (assignmentStatusLabels[a.status] ?? a.status)}
            className={cn("rounded-full ring-2", intentStyles[getStatusIntent("assignment", a.status)].ring)}
          >
            <PersonAvatar name={personName(a)} src={a.crewMember.image ?? undefined} className="size-7" />
          </span>
        ))}
      </span>
      <span className={cn("text-caption", short ? "font-medium text-t-out" : "text-muted")}>
        {short ? crewText(s) + " · " + short + " needed" : crewText(s)}
      </span>
    </div>
  );
}

function DayCard({
  s, selection, menu, onOpen,
}: { s: LogisticsService; selection: RowSelection; menu?: ActionMenuSpec; onOpen: () => void }) {
  const directions = directionsHref(s);
  const when = whenText(s);
  return (
    <div
      data-row-id={s.id}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, [role='checkbox'], [role='menu']")) onOpen();
      }}
      className="cursor-pointer border-t border-line px-1 py-3"
    >
      <div className="flex items-center gap-1">
        <Checkbox
          aria-label={"Select " + s.title}
          checked={selection.isSelected(s.id)}
          onClick={(e) => {
            e.preventDefault();
            selection.toggle(s.id, { shift: e.shiftKey });
          }}
          className="[&>span]:size-[22px]"
        />
        <span className="t-mono min-w-0 flex-1 text-[18px] font-semibold text-ink">{when || "No time"}</span>
        <StatusWord status={serviceStatusValue(s)} />
        {menu && <ActionMenu spec={menu} label={s.title + " actions"} />}
      </div>
      <div className="pl-9">
        <div className="truncate text-ui-text font-medium text-ink">{s.title}</div>
        {whereLine(s) && <div className="truncate text-caption text-muted">{whereLine(s)}</div>}
        {directions && (
          <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-caption text-link">
            Directions
          </a>
        )}
        {s.notes && <div className="truncate text-caption text-muted">{s.notes}</div>}
        <CrewStack s={s} />
      </div>
    </div>
  );
}

export function DayMode({
  groups, day, onDay, selection, menuFor, onOpen, onOpenOrder,
}: {
  onOpenOrder: (subHireId: string) => void;
  groups: DayGroup[];
  day: string;
  onDay: (key: string) => void;
  selection: RowSelection;
  menuFor: (s: LogisticsService) => ActionMenuSpec | undefined;
  onOpen: (s: LogisticsService) => void;
}) {
  const current = groups.find((g) => g.key === day) ?? groups[0];
  if (!current) return null;
  return (
    <div>
      <div role="group" aria-label="Day" className="-mx-1 flex overflow-x-auto border-b border-line">
        {groups.map((g) => (
          <DayChip key={g.key || "tbc"} group={g} active={g.key === current.key} onClick={() => onDay(g.key)} />
        ))}
      </div>
      {current.services.length === 0 && !current.stops?.length && <p className="p-4 text-muted">Nothing on this day.</p>}
      {current.services.map((s) => (
        <DayCard key={s.id} s={s} selection={selection} menu={menuFor(s)} onOpen={() => onOpen(s)} />
      ))}
      {current.stops?.map((st) => <TransportStopRow key={st.id} stop={st} onOpen={onOpenOrder} />)}
      <DayCrew services={current.services} />
    </div>
  );
}

/** The day's crew with their status words, beneath the cards. */
function DayCrew({ services }: { services: LogisticsService[] }) {
  const rows = services.flatMap((s) => s.crewAssignments.map((a) => ({ a, s })));
  if (rows.length === 0) return null;
  return (
    <section aria-label="Crew on the day" className="mt-4">
      <h3 className="t-overline px-1 text-ink">{"Crew on the day · " + rows.length}</h3>
      {rows.map(({ a, s }) => (
        <div key={a.id} className="flex min-h-12 items-center gap-2 border-t border-line px-1">
          <PersonAvatar name={personName(a)} src={a.crewMember.image ?? undefined} className="size-7" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-text text-ink">{personName(a)}</div>
            <div className="truncate text-caption text-muted">{s.title + " · " + whenText(s)}</div>
          </div>
          <StatusWord
            status={{ label: assignmentStatusLabels[a.status] ?? a.status, intent: getStatusIntent("assignment", a.status) }}
          />
        </div>
      ))}
    </section>
  );
}

