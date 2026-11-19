"use client";

import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionMenu } from "@/components/ui/action-menu";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";
import { dispatchText, floorFlags, progressOf, windowText, type FloorJob } from "@/lib/warehouse-floor";

export interface FloorCardProps {
  job: FloorJob;
  now: number;
  selected: boolean;
  onToggle: (shift: boolean) => void;
  ringed: boolean;
  menu: ActionMenuSpec;
}

const FLAG_TONE = { error: "text-t-out", warning: "text-warn" } as const;

function Flags({ job, now, max }: { job: FloorJob; now: number; max?: number }) {
  const flags = floorFlags(job, now).slice(0, max);
  if (flags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-caption">
      {flags.map((f) => (
        <span key={f.key} className={cn("inline-flex items-center gap-1", FLAG_TONE[f.tone])}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {f.label}
        </span>
      ))}
    </span>
  );
}

function Bar({ ratio }: { ratio: number }) {
  return (
    <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-full bg-line">
      <span className="block h-full bg-ink/70" style={{ width: `${Math.round(Math.min(1, ratio) * 100)}%` }} />
    </span>
  );
}

/**
 * One job on the board (spec §9c.2). The WHOLE card opens the warehouse job
 * (a stretched link on the name); the checkbox and ⋯ sit above it. No status
 * pill, no stepper, no per-card buttons: the column is the stage. The packer
 * line is not built yet (no packer field); `dispatch` keeps its own line so it
 * can join later without restructuring.
 */
export function FloorCard({ job, now, selected, onToggle, ringed, menu }: FloorCardProps) {
  const progress = progressOf(job);
  const dispatch = dispatchText(job);
  return (
    <article
      id={`floor-card-${job.id}`}
      data-ringed={ringed ? "true" : undefined}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-[var(--r)] border border-line bg-elev p-3 transition-shadow hover:border-line-2",
        ringed && "ring-2 ring-info ring-offset-1",
        selected && "border-line-2 bg-paper-2/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          className="relative z-10"
          checked={selected}
          aria-label={`Select #${job.projectNumber}`}
          onClick={(e) => { e.preventDefault(); onToggle(e.shiftKey); }}
        />
        <span className="font-mono text-caption text-muted">#{job.projectNumber}</span>
        <span className="ml-auto relative z-10">
          <ActionMenu spec={menu} label={`Actions for #${job.projectNumber}`} />
        </span>
      </div>
      <Link
        href={`/warehouse/${job.id}`}
        className="truncate text-ui-text font-medium text-ink after:absolute after:inset-0 after:rounded-[var(--r)] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-red"
      >
        {job.name}
      </Link>
      {windowText(job) ? <span className="truncate text-caption text-muted">{windowText(job)}</span> : null}
      <span className="flex flex-col gap-1">
        <span className="text-caption text-ink tabular-nums">{progress.text}</span>
        <Bar ratio={progress.ratio} />
      </span>
      {dispatch ? <span className="truncate text-caption text-muted">{dispatch}</span> : null}
      <Flags job={job} now={now} />
    </article>
  );
}

/**
 * The phone row (spec §9c.6): 64 px, a 22 px checkbox, an always-visible 40 px
 * ⋯ (D39). Name, then `#n · client · dates`, then the dispatch line; on the
 * right the first number and the first flag.
 */
export function FloorPhoneRow({ job, now, selected, onToggle, ringed, menu }: FloorCardProps) {
  const progress = progressOf(job);
  const dispatch = dispatchText(job);
  return (
    <article
      id={`floor-card-${job.id}`}
      data-ringed={ringed ? "true" : undefined}
      className={cn(
        "relative flex min-h-16 items-center gap-3 border-b border-line px-1 py-2",
        ringed && "ring-2 ring-info ring-inset",
      )}
    >
      <Checkbox
        className="relative z-10 size-[22px]"
        checked={selected}
        aria-label={`Select #${job.projectNumber}`}
        onClick={(e) => { e.preventDefault(); onToggle(false); }}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <Link href={`/warehouse/${job.id}`} className="truncate text-ui-text font-medium text-ink after:absolute after:inset-0">
          {job.name}
        </Link>
        <span className="truncate text-caption text-muted">{[`#${job.projectNumber}`, windowText(job)].filter(Boolean).join(" · ")}</span>
        {dispatch ? <span className="truncate text-caption text-muted">{dispatch}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span className="text-caption text-ink tabular-nums">{progress.text.split(" · ").pop()}</span>
        <Flags job={job} now={now} max={1} />
      </span>
      <span className="relative z-10">
        <ActionMenu spec={menu} label={`Actions for #${job.projectNumber}`} />
      </span>
    </article>
  );
}
