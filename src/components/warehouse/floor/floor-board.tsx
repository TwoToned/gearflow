"use client";

import { StatusWord } from "@/components/ui/status-word";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { floorStageIntent } from "@/lib/status-colors";
import { FLOOR_STAGE_LABELS } from "@/lib/vocabulary";
import { byStage, type FloorJob } from "@/lib/warehouse-floor";
import { FLOOR_STAGE_KEYS, type FloorStage } from "../../../../convex/lib/warehouseStage";
import { FloorCard, FloorPhoneRow } from "./floor-card";

export interface FloorBoardProps {
  jobs: readonly FloorJob[];
  now: number;
  ringedId: string | null;
  isSelected: (id: string) => boolean;
  onToggle: (id: string, shift: boolean) => void;
  menuFor: (job: FloorJob) => ActionMenuSpec;
  /** Packer names by user id (the org roster). */
  packerNames?: ReadonlyMap<string, string>;
}

function StageHead({ stage, count }: { stage: FloorStage; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-caption font-medium">
      <StatusWord status={{ label: FLOOR_STAGE_LABELS[stage], intent: floorStageIntent[stage] }} />
      <span className="font-mono text-muted tabular-nums">{count}</span>
    </h2>
  );
}

/** Desktop (spec §9c.2): five derived columns, never dragged (D27). */
export function FloorBoard({ jobs, now, ringedId, isSelected, onToggle, menuFor, packerNames }: FloorBoardProps) {
  const cols = byStage(jobs);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5" data-testid="floor-board">
      {FLOOR_STAGE_KEYS.map((stage) => (
        <section key={stage} aria-label={FLOOR_STAGE_LABELS[stage]} className="flex min-w-0 flex-col gap-2">
          <StageHead stage={stage} count={cols[stage].length} />
          {cols[stage].map((job) => (
            <FloorCard
              key={job.id}
              job={job}
              now={now}
              ringed={ringedId === job.id}
              selected={isSelected(job.id)}
              onToggle={(shift) => onToggle(job.id, shift)}
              menu={menuFor(job)}
              packerName={job.packerUserId ? packerNames?.get(job.packerUserId) ?? null : null}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/** Phone (spec §9c.6): the board is hidden, not squeezed — rows grouped by stage under hairline heads. */
export function FloorPhoneList({ jobs, now, ringedId, isSelected, onToggle, menuFor, stage }: FloorBoardProps & { stage: FloorStage | null }) {
  const cols = byStage(jobs);
  const stages = stage ? [stage] : FLOOR_STAGE_KEYS.filter((s) => cols[s].length > 0);
  return (
    <div className="flex flex-col gap-4" data-testid="floor-phone-list">
      {stages.map((s) => (
        <section key={s} aria-label={FLOOR_STAGE_LABELS[s]} className="flex flex-col">
          <div className="border-b border-line pb-1">
            <StageHead stage={s} count={cols[s].length} />
          </div>
          {cols[s].map((job) => (
            <FloorPhoneRow
              key={job.id}
              job={job}
              now={now}
              ringed={ringedId === job.id}
              selected={isSelected(job.id)}
              onToggle={(shift) => onToggle(job.id, shift)}
              menu={menuFor(job)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
