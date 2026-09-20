"use client";
// use-client: interactive — local draft state, menus, optimistic write (R-8.1.1)

import { useCallback, useMemo, useState, type RefObject } from "react";
import { Plus, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { useStableNow } from "@/hooks/use-stable-now";
import { TASK_STAGE_LABELS, type ProjectTaskStage, type ProjectTaskPriority } from "@/lib/project-tasks";
import { resolveWorkDue, workDueLabel, workDueDefault, type WorkDueValue } from "@/lib/work-due-dates";
import { describeWorkDestination, type WorkDestination } from "@/lib/work-destination";
import { cn, focusRing } from "@/lib/utils";
import { OwnerChip, StageChip, DueChip, PriorityChip } from "./composer-chips";
import { ownerLabel, type WorkComposerAssignees, type WorkComposerOwner } from "./work-composer-owner";

export type { WorkComposerOwner };

/**
 * ONE composer for every place work is created — Today, the project rail, the
 * Overview card, the Work tab (work-layer v2 §4.1).
 *
 * What makes it worth being a component rather than four inputs: it **names
 * its destination before you commit**, and it refuses to create a row that no
 * surface would show. A personal item with no owner and no project is written,
 * audited and then read by nothing — `myOpenTasks` scans the assignee indexes
 * and every project surface needs a `projectId`. `createNative` defaults the
 * owner as a server-side backstop; this is the half a human can see.
 *
 * The destination line is not decoration. The vanishing quick-add shipped
 * because nothing in the UI ever said where a row would land, so "nowhere"
 * looked exactly like "somewhere".
 *
 * **Layout: the title input owns its own row, always.** The chips and the Add
 * button sit on a second row beneath it. The one-row version put the input in
 * a flex race against four chips it could never win — in the 340px project
 * rail the field collapsed to about forty pixels and you could not read what
 * you were typing. A row that wraps is the only arrangement whose narrowest
 * case is still usable, and the composer's narrowest host is its most used one.
 *
 * Every field a new row can carry is set HERE, before Add: owner, stage, due
 * date and priority. Creating a row and then opening it to set its date is two
 * round trips for one thought.
 */

export interface WorkComposerProps {
  /** Absent = a personal item (Today). Set = scoped to that job. */
  projectId?: string;
  /** Project scope only — the stage a new row starts in. */
  defaultStage?: ProjectTaskStage | null;
  /** Who owns a new row before the user changes it. Defaults to the signed-in
   *  user on a personal composer, and to `nobody` on a project (unowned work
   *  is a legitimate, visible state on a job — see the rail's Nobody lane). */
  defaultOwner?: WorkComposerOwner;
  assignees?: WorkComposerAssignees;
  /** Fired after a successful create — hosts that aren't live-subscribed
   *  (the project rail reads through a fetch) refetch here. */
  onCreated?: () => void;
  /** One line until there's something to add; the chips appear with the text.
   *  Used in the 340px rail and the Overview card, where a permanent chip row
   *  would cost more height than it earns. */
  compact?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  className?: string;
}

/** Who a new row starts owned by. Personal composers default to the signed-in
 *  user (the server defaults the same way as a backstop); a project composer
 *  starts unowned, because unowned project work is a legitimate, visible
 *  state rather than something to pin on whoever typed it. */
function resolveInitialOwner(
  defaultOwner: WorkComposerOwner | undefined,
  projectId: string | undefined,
  meId: string | undefined,
): WorkComposerOwner {
  if (defaultOwner) return defaultOwner;
  if (projectId || !meId) return { kind: "nobody" };
  return { kind: "user", id: meId };
}

/** The create payload. Split out of the submit handler (R-3.6): the
 *  project/personal split touches two fields, and each ternary is a branch
 *  the component would otherwise carry. A due date is NOT one of them any
 *  more — job work is dated the same way personal work is. */
function buildCreateInput(args: {
  title: string;
  projectId: string | undefined;
  stage: ProjectTaskStage | null;
  due: WorkDueValue;
  nowMs: number;
  timezone: string | undefined;
  owner: WorkComposerOwner;
  priority: ProjectTaskPriority;
}) {
  return {
    title: args.title,
    projectId: args.projectId,
    stage: args.projectId ? (args.stage ?? undefined) : undefined,
    dueDate: resolveWorkDue(args.due, args.nowMs, args.timezone),
    // NORMAL is what the server writes for an unset priority, so sending it
    // explicitly changes nothing — only a deliberate LOW/HIGH is a choice.
    priority: args.priority === "NORMAL" ? undefined : args.priority,
    assigneeUserId: args.owner.kind === "user" ? args.owner.id : undefined,
    assigneeCrewId: args.owner.kind === "crew" ? args.owner.id : undefined,
  };
}

const composerPlaceholder = (given: string | undefined, projectId: string | undefined): string =>
  given ?? (projectId ? "Add work to this job…" : "Add work…");

const canSubmitWork = (title: string, busy: boolean, blocked: boolean): boolean =>
  title.length > 0 && !busy && !blocked;

/** The "where will this land" line. Its own component so the composer doesn't
 *  carry the warn/muted split and the icon's conditional (R-3.6). */
function DestinationLine({ destination }: { destination: WorkDestination }) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 border-t border-dashed border-line px-3 py-1.5 text-caption",
        destination.blocked ? "text-warn" : "text-muted",
      )}
    >
      {destination.blocked && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
      {destination.text}
    </p>
  );
}

export function WorkComposer({
  projectId,
  defaultStage,
  defaultOwner,
  assignees,
  onCreated,
  compact = false,
  inputRef,
  placeholder,
  className,
}: WorkComposerProps) {
  const { data: session } = useSession();
  const meId = session?.user.id;
  const writes = useProjectTaskWrites();
  const { timezone } = useDocumentDatesConfig();
  // Mount-time snapshot: presets resolve against it and the chip renders from
  // it, so both agree on which day "today" is for as long as the draft lives.
  const nowMs = useStableNow();

  const initialOwner = useMemo(
    () => resolveInitialOwner(defaultOwner, projectId, meId),
    [defaultOwner, projectId, meId],
  );

  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<WorkComposerOwner>(initialOwner);
  const [due, setDue] = useState<WorkDueValue>(() => workDueDefault(!!projectId));
  const [stage, setStage] = useState<ProjectTaskStage | null>(defaultStage ?? null);
  const [priority, setPriority] = useState<ProjectTaskPriority>("NORMAL");
  const [busy, setBusy] = useState(false);

  const trimmed = title.trim();
  const dueText = workDueLabel(due, nowMs, timezone);
  const destination = useMemo(
    () =>
      describeWorkDestination({
        hasProject: !!projectId,
        ownerKind: owner.kind,
        isMe: owner.kind === "user" && owner.id === meId,
        ownerName: ownerLabel(owner, assignees, meId),
        stageLabel: stage ? TASK_STAGE_LABELS[stage] : null,
        dueLabel: dueText,
      }),
    [projectId, owner, meId, assignees, stage, dueText],
  );
  const canSubmit = canSubmitWork(trimmed, busy, destination.blocked);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    setBusy(true);
    writes
      .create(buildCreateInput({ title: trimmed, projectId, stage, due, nowMs, timezone, owner, priority }))
      .then(() => {
        // The chips keep their settings: adding five things to the same stage
        // for the same person is one intent, not five. Only the title clears.
        setTitle("");
        onCreated?.();
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add the work"))
      .finally(() => setBusy(false));
  }, [canSubmit, writes, trimmed, projectId, stage, due, nowMs, timezone, owner, priority, onCreated]);

  // Compact hosts keep the chip row hidden until there's a draft to place.
  const showChips = !compact || trimmed.length > 0;

  return (
    <form
      className={cn(
        "rounded-[var(--r)] border bg-card",
        destination.blocked ? "border-warn" : "border-line",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Plus className="size-4 shrink-0 text-muted" aria-hidden />
        <label htmlFor="work-composer-title" className="sr-only">
          Add work
        </label>
        <input
          id="work-composer-title"
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={composerPlaceholder(placeholder, projectId)}
          disabled={busy}
          className="w-full min-w-0 flex-1 bg-transparent text-ui-text text-ink placeholder:text-faint focus:outline-none"
        />
      </div>

      {showChips && (
        <>
          <ComposerControls
            owner={owner}
            onOwnerChange={setOwner}
            assignees={assignees}
            meId={meId}
            projectId={projectId}
            stage={stage}
            onStageChange={setStage}
            due={due}
            dueText={dueText}
            onDueChange={setDue}
            priority={priority}
            onPriorityChange={setPriority}
            canSubmit={canSubmit}
            busy={busy}
          />
          <DestinationLine destination={destination} />
        </>
      )}
    </form>
  );
}

/** The chip row and the Add button. Split out of `WorkComposer` (R-3.6)
 *  purely to keep that function's own branch count down — every chip and
 *  every disabled state is a branch, and they all belong to one row.
 *
 *  It WRAPS: four chips plus a button will not fit a 340px rail on one line,
 *  and the alternative to wrapping is a horizontal scroll that hides whichever
 *  chip is off the end. The Add button is pushed to the end of the last line
 *  by `ml-auto`, so it stays the rightmost thing at every width. */
function ComposerControls({
  owner,
  onOwnerChange,
  assignees,
  meId,
  projectId,
  stage,
  onStageChange,
  due,
  dueText,
  onDueChange,
  priority,
  onPriorityChange,
  canSubmit,
  busy,
}: {
  owner: WorkComposerOwner;
  onOwnerChange: (o: WorkComposerOwner) => void;
  assignees: WorkComposerAssignees | undefined;
  meId: string | undefined;
  projectId: string | undefined;
  stage: ProjectTaskStage | null;
  onStageChange: (s: ProjectTaskStage | null) => void;
  due: WorkDueValue;
  dueText: string;
  onDueChange: (d: WorkDueValue) => void;
  priority: ProjectTaskPriority;
  onPriorityChange: (p: ProjectTaskPriority) => void;
  canSubmit: boolean;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
      <OwnerChip owner={owner} onChange={onOwnerChange} assignees={assignees} meId={meId} allowNobody={!!projectId} />
      {projectId && <StageChip stage={stage} onChange={onStageChange} />}
      <DueChip due={due} label={dueText} onChange={onDueChange} />
      <PriorityChip priority={priority} onChange={onPriorityChange} />
      <button
        type="submit"
        disabled={!canSubmit}
        className={cn(
          "ml-auto shrink-0 rounded-full px-3.5 py-1.5 text-badge font-semibold transition-colors",
          canSubmit ? "bg-primary text-primary-foreground shadow-[var(--sh-stk)]" : "cursor-not-allowed bg-elev text-faint",
          focusRing,
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-label="Adding" /> : "Add"}
      </button>
    </div>
  );
}
