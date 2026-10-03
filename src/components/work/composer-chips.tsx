"use client";
// use-client: interactive — Radix dropdown triggers (R-8.1.1)

import React from "react";
import { ChevronDown, Clock, Flag, FileText } from "lucide-react";
import {
  TASK_STAGES,
  TASK_STAGE_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type ProjectTaskStage,
  type ProjectTaskPriority,
} from "@/lib/project-tasks";
import {
  WORK_DUE_PRESETS,
  WORK_DUE_PRESET_LABELS,
  type WorkDates,
} from "@/lib/work-due-dates";
import { PersonAvatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn, focusRing } from "@/lib/utils";
import { ownerLabel, type WorkComposerAssignees, type WorkComposerOwner } from "./work-composer-owner";

/**
 * The composer's four setting chips (owner / stage / due / priority).
 *
 * Split out of `work-composer.tsx` only for size (R-4.1) — they are one
 * family, they are used nowhere else, and they share `ChipButton`'s
 * ref-forwarding contract, which is the thing that actually has to stay
 * together (see its own comment).
 */

/**
 * A chip trigger.
 *
 * **It MUST forward its props and its ref.** Every chip is a
 * `DropdownMenuTrigger asChild` child, and `asChild` works by cloning this
 * element with Radix's own handlers, `ref`, `aria-expanded` and `data-state`
 * on it. A component that destructures the props it knows about and drops the
 * rest throws all of that away silently: the chip renders perfectly, is
 * announced as a plain button, and **does nothing when clicked** — which is
 * exactly how the owner/stage/due menus shipped dead. Nothing catches it but
 * a test that clicks the chip and looks for the menu, which is why
 * `work-composer.smoke.test.tsx` does.
 */
const ChipButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    ariaLabel: string;
    /** A chip holding a non-default value reads as SET, not as another
     *  placeholder — otherwise a picked date looks like the same grey
     *  furniture as an empty one and you re-check it every time. */
    active?: boolean;
  }
>(function ChipButton({ children, ariaLabel, active = false, className, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-2 pr-1.5 text-caption font-medium hover:border-faint hover:text-ink",
        active ? "border-faint bg-elev text-ink" : "border-line-2 bg-paper-2 text-ink-2",
        focusRing,
        className,
      )}
    >
      {children}
      <ChevronDown className="size-3" aria-hidden />
    </button>
  );
});

export function OwnerChip({
  owner,
  onChange,
  assignees,
  meId,
  allowNobody,
}: {
  owner: WorkComposerOwner;
  onChange: (o: WorkComposerOwner) => void;
  assignees: WorkComposerAssignees | undefined;
  meId: string | undefined;
  allowNobody: boolean;
}) {
  const label = ownerLabel(owner, assignees, meId);
  const others = (assignees?.users ?? []).filter((u) => u.id !== meId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={`Owner: ${label}`} active={owner.kind !== "nobody"}>
          {owner.kind === "nobody" ? (
            <span
              className="grid size-[18px] place-items-center rounded-full border border-dashed border-faint text-[9px] text-muted"
              aria-hidden
            >
              ?
            </span>
          ) : (
            <PersonAvatar name={label} className="size-[18px] text-[9px]" />
          )}
          {label}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Owner</DropdownMenuLabel>
          {meId && (
            <DropdownMenuItem onClick={() => onChange({ kind: "user", id: meId })}>Me</DropdownMenuItem>
          )}
          {allowNobody && (
            <DropdownMenuItem onClick={() => onChange({ kind: "nobody" })}>
              Nobody — leave it on the job
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Team</DropdownMenuLabel>
              {others.map((u) => (
                <DropdownMenuItem key={u.id} onClick={() => onChange({ kind: "user", id: u.id })}>
                  {u.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {(assignees?.crew ?? []).length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Crew</DropdownMenuLabel>
              {assignees!.crew.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => onChange({ kind: "crew", id: c.id })}>
                  {`${c.firstName} ${c.lastName}`.trim()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The "when" chip: the due date, plus an optional start date that turns the
 * row into a SPAN.
 *
 * Both ends are native `<input type="date">` fields — the codebase convention
 * for a single date, and the one control that already has a keyboard path, a
 * locale-correct format and the platform's own calendar popover. Their value
 * is `YYYY-MM-DD`, which is exactly what `writes.create` takes, so nothing is
 * parsed or reformatted on the way through.
 *
 * The start field's `max` is the resolved due date, so the browser itself
 * refuses an inverted span; `resolveWorkDates` drops one anyway if it gets
 * through, and the Convex mutation rejects it as the real gate. Three layers
 * of the same rule, each doing the job of its own layer — the UI's is to not
 * make the user round-trip a server error for something it can see.
 */
export function DatesChip({
  dates,
  label,
  resolvedDue,
  onChange,
}: {
  dates: WorkDates;
  label: string;
  /** The due date the presets resolve to, as `YYYY-MM-DD` — or null when
   *  there is none, which is what makes a start date meaningless. */
  resolvedDue: string | null;
  onChange: (d: WorkDates) => void;
}) {
  const isSet = dates.due.kind === "date" || dates.due.preset !== "none";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={`Dates: ${label}`} active={isSet}>
          <Clock className="size-3.5" aria-hidden />
          {label}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Due</DropdownMenuLabel>
          {WORK_DUE_PRESETS.map((p) => (
            <DropdownMenuItem
              key={p}
              onClick={() => onChange({ ...dates, due: { kind: "preset", preset: p } })}
            >
              {WORK_DUE_PRESET_LABELS[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* Typing into a date field inside a menu would otherwise dismiss it
            after the first digit — the menu treats keydown as navigation. */}
        <div className="space-y-2 px-2 pb-1.5 pt-1" onKeyDown={(e) => e.stopPropagation()}>
          <DateField
            id="work-composer-due-date"
            label="Due on"
            value={dates.due.kind === "date" ? dates.due.date : ""}
            onChange={(v) =>
              onChange({
                ...dates,
                due: v ? { kind: "date", date: v } : { kind: "preset", preset: "none" },
              })
            }
          />
          {/* A start with no due date is not a span — there is nothing to run
              to — so the field only appears once there is an end to run to. */}
          {resolvedDue && (
            <DateField
              id="work-composer-start-date"
              label="Starts on"
              value={dates.start ?? ""}
              max={resolvedDue}
              hint="Runs as a bar on the calendar"
              onChange={(v) => onChange({ ...dates, start: v || null })}
            />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One labelled date field. Both ends of the span are the same control, so
 *  they are the same component (R-3.1) — a second hand-rolled copy is how the
 *  two ends end up with different sizing or a missing label. */
function DateField({
  id,
  label,
  value,
  onChange,
  max,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-caption text-muted">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-[var(--r-sm)] border border-line-2 bg-paper-2 px-2 py-1 text-caption text-ink",
          focusRing,
        )}
      />
      {hint && <p className="mt-0.5 text-[10px] text-faint">{hint}</p>}
    </div>
  );
}

/**
 * Notes. A chip rather than a permanent second line, because the composer's
 * narrowest host is the 340px rail, where it is already two rows tall and a
 * third would push the work list itself off the visible area. The chip shows a
 * dot once there is something in it, so notes you typed can't be invisible.
 */
export function NotesChip({ notes, onChange }: { notes: string; onChange: (v: string) => void }) {
  const has = notes.trim().length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={has ? "Notes: added" : "Notes: none"} active={has}>
          <FileText className="size-3.5" aria-hidden />
          Notes
          {has && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="px-2 pb-1.5 pt-1" onKeyDown={(e) => e.stopPropagation()}>
          <label htmlFor="work-composer-notes" className="mb-1 block text-caption text-muted">
            Notes
          </label>
          <textarea
            id="work-composer-notes"
            value={notes}
            rows={4}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Anything the person doing this needs to know…"
            className={cn(
              "w-full resize-y rounded-[var(--r-sm)] border border-line-2 bg-paper-2 px-2 py-1.5 text-caption text-ink placeholder:text-faint",
              focusRing,
            )}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Priority. NORMAL is the unset state and prints as "Priority" rather than
 *  "Normal": a chip that names a value you did not choose reads as a setting
 *  to review, and there is nothing to review about the default. */
export function PriorityChip({
  priority,
  onChange,
}: {
  priority: ProjectTaskPriority;
  onChange: (p: ProjectTaskPriority) => void;
}) {
  const isSet = priority !== "NORMAL";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={`Priority: ${TASK_PRIORITY_LABELS[priority]}`} active={isSet}>
          <Flag className={cn("size-3.5", priority === "HIGH" && "text-warn")} aria-hidden />
          {isSet ? TASK_PRIORITY_LABELS[priority] : "Priority"}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Priority</DropdownMenuLabel>
          {TASK_PRIORITIES.map((p) => (
            <DropdownMenuItem key={p} onClick={() => onChange(p)}>
              {TASK_PRIORITY_LABELS[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StageChip({
  stage,
  onChange,
}: {
  stage: ProjectTaskStage | null;
  onChange: (s: ProjectTaskStage | null) => void;
}) {
  const label = stage ? TASK_STAGE_LABELS[stage] : "No stage";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={`Stage: ${label}`} active={!!stage}>
          {label}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Stage</DropdownMenuLabel>
          {TASK_STAGES.map((s) => (
            <DropdownMenuItem key={s} onClick={() => onChange(s)}>
              {TASK_STAGE_LABELS[s]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => onChange(null)}>No stage</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
