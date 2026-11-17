"use client";

/** The list area: empty state, By person, phone day mode, or the desktop timeline. */
import { EmptyState } from "@/components/ui/empty-state";
import { useIsMobile } from "@/hooks/use-mobile";
import type { DayGroup, LogisticsService } from "@/lib/logistics-model";
import type { ActionMenuSpec, FactColumn, LineRowData, RowSelection } from "@/lib/primitives/types";
import { DayMode } from "./day-mode";
import type { LogisticsView } from "./lane-bar";
import { PeopleView, type CrewAssignmentRow } from "./people-view";
import { Timeline } from "./timeline";

export interface ContentProps {
  view: LogisticsView;
  hasServices: boolean;
  hasDates: boolean;
  groups: DayGroup[];
  crew: CrewAssignmentRow[];
  selection: RowSelection;
  columns: FactColumn[];
  day: string;
  onDay: (key: string) => void;
  loadInDay: string;
  loadOutDay: string;
  serviceRow: (s: LogisticsService) => LineRowData;
  crewRow: (a: CrewAssignmentRow) => LineRowData;
  serviceMenu: (s: LogisticsService) => ActionMenuSpec | undefined;
  onOpenService: (s: LogisticsService) => void;
  onOpenOrder: (subHireId: string) => void;
}

export function LogisticsContent(p: ContentProps) {
  const isMobile = useIsMobile();
  if (p.view === "people") return <PeopleView rows={p.crew} selection={p.selection} rowFor={p.crewRow} />;
  if (!p.hasServices) {
    return (
      <EmptyState
        title="No logistics yet"
        description={
          p.hasDates
            ? "Generate delivery, bump in and pickup from your job dates (page menu), or add them below."
            : "Set the job dates first, then generate the run automatically, or add services below."
        }
      />
    );
  }
  if (isMobile) {
    return (
      <DayMode groups={p.groups} day={p.day} onDay={p.onDay} selection={p.selection} menuFor={p.serviceMenu} onOpen={p.onOpenService} onOpenOrder={p.onOpenOrder} />
    );
  }
  const byId = new Map(p.groups.flatMap((g) => g.services).map((s) => [s.id, s]));
  // (`hasServices` already counts sub-hire stops, so a stops-only job still gets its timeline.)
  return (
    <Timeline
      groups={p.groups}
      rowFor={(id) => p.serviceRow(byId.get(id)!)}
      columns={p.columns}
      selection={p.selection}
      loadInDay={p.loadInDay}
      loadOutDay={p.loadOutDay}
      onOpenOrder={p.onOpenOrder}
    />
  );
}
