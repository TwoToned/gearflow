"use client";
// use-client: interactive — Radix dropdown triggers (R-8.1.1)

import React from "react";
import { ChevronDown, Clock, Flag } from "lucide-react";
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
  type WorkDueValue,
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
 * The "when" chip: the three presets that cover most work, plus a real date
 * field for everything else.
 *
 * The date field is a native `<input type="date">` — the codebase convention
 * for a single date, and the one control that already has a keyboard path, a
 * locale-correct format and the platform's own calendar popover. Its value is
 * `YYYY-MM-DD`, which is exactly what `writes.create` takes, so nothing is
 * parsed or reformatted on the way through.
 */
export function DueChip({
  due,
  label,
  onChange,
}: {
  due: WorkDueValue;
  label: string;
  onChange: (d: WorkDueValue) => void;
}) {
  const isSet = due.kind === "date" || due.preset !== "none";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={`Due: ${label}`} active={isSet}>
          <Clock className="size-3.5" aria-hidden />
          {label}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Due</DropdownMenuLabel>
          {WORK_DUE_PRESETS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => onChange({ kind: "preset", preset: p })}>
              {WORK_DUE_PRESET_LABELS[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <div className="px-2 pb-1.5 pt-1">
          <label htmlFor="work-composer-due-date" className="mb-1 block text-caption text-muted">
            Pick a date
          </label>
          <input
            id="work-composer-due-date"
            type="date"
            value={due.kind === "date" ? due.date : ""}
            // The menu closes on keydown otherwise — typing a date would
            // dismiss the thing you are typing into after the first digit.
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              onChange(
                e.target.value ? { kind: "date", date: e.target.value } : { kind: "preset", preset: "none" },
              )
            }
            className={cn(
              "w-full rounded-[var(--r-sm)] border border-line-2 bg-paper-2 px-2 py-1 text-caption text-ink",
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
