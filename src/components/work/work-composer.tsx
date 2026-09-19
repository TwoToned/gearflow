"use client";
// use-client: interactive — local draft state, menus, optimistic write (R-8.1.1)

import { useCallback, useMemo, useState, type RefObject } from "react";
import { Plus, ChevronDown, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useProjectTaskWrites } from "@/hooks/use-project-tasks-writes";
import { useDocumentDatesConfig } from "@/hooks/use-document-dates-config";
import { TASK_STAGES, TASK_STAGE_LABELS, type ProjectTaskStage } from "@/lib/project-tasks";
import {
  WORK_DUE_PRESETS,
  WORK_DUE_PRESET_LABELS,
  resolveDuePreset,
  type WorkDuePreset,
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
 */

interface WorkComposerAssignees {
  users: { id: string; name: string; image?: string | null }[];
  crew: { id: string; firstName: string; lastName: string }[];
}

export type WorkComposerOwner =
  | { kind: "user"; id: string }
  | { kind: "crew"; id: string }
  | { kind: "nobody" };

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

function ownerLabel(owner: WorkComposerOwner, assignees: WorkComposerAssignees | undefined, meId: string | undefined): string {
  if (owner.kind === "nobody") return "Nobody";
  if (owner.kind === "crew") {
    const c = assignees?.crew.find((x) => x.id === owner.id);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "Crew";
  }
  if (owner.id === meId) return "Me";
  return assignees?.users.find((u) => u.id === owner.id)?.name ?? "Someone";
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

  const initialOwner: WorkComposerOwner = useMemo(
    () => defaultOwner ?? (projectId ? { kind: "nobody" } : meId ? { kind: "user", id: meId } : { kind: "nobody" }),
    [defaultOwner, projectId, meId],
  );

  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<WorkComposerOwner>(initialOwner);
  const [due, setDue] = useState<WorkDuePreset>(projectId ? "none" : "today");
  const [stage, setStage] = useState<ProjectTaskStage | null>(defaultStage ?? null);
  const [busy, setBusy] = useState(false);

  const trimmed = title.trim();
  // The one state the product must not be able to produce: nobody to show it
  // to, and no job to hang it on.
  const wouldLandNowhere = !projectId && owner.kind === "nobody";
  const canSubmit = trimmed.length > 0 && !busy && !wouldLandNowhere;

  const destination = useMemo(() => {
    if (wouldLandNowhere) {
      return "Nobody owns this and it has no job — it would land nowhere. Pick an owner.";
    }
    const who =
      owner.kind === "nobody"
        ? "this job's work list"
        : owner.kind === "user" && owner.id === meId
          ? "your work list"
          : `${ownerLabel(owner, assignees, meId)}’s work list`;
    const when = projectId
      ? stage
        ? TASK_STAGE_LABELS[stage]
        : "no stage"
      : WORK_DUE_PRESET_LABELS[due].toLowerCase();
    return `Lands in ${who} · ${when}`;
  }, [wouldLandNowhere, owner, meId, assignees, projectId, stage, due]);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    setBusy(true);
    writes
      .create({
        title: trimmed,
        projectId,
        stage: projectId ? (stage ?? undefined) : undefined,
        dueDate: projectId ? undefined : resolveDuePreset(due, Date.now(), timezone),
        assigneeUserId: owner.kind === "user" ? owner.id : undefined,
        assigneeCrewId: owner.kind === "crew" ? owner.id : undefined,
      })
      .then(() => {
        setTitle("");
        onCreated?.();
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add the work"))
      .finally(() => setBusy(false));
  }, [canSubmit, writes, trimmed, projectId, stage, due, timezone, owner, onCreated]);

  // Compact hosts keep the chip row hidden until there's a draft to place.
  const showChips = !compact || trimmed.length > 0;

  return (
    <form
      className={cn(
        "rounded-[var(--r)] border bg-card",
        wouldLandNowhere ? "border-warn" : "border-line",
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
          placeholder={placeholder ?? (projectId ? "Add work to this job…" : "Add work…")}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-ui-text text-ink placeholder:text-faint focus:outline-none"
        />

        {showChips && (
          <>
            <OwnerChip owner={owner} onChange={setOwner} assignees={assignees} meId={meId} allowNobody={!!projectId} />
            {projectId ? (
              <StageChip stage={stage} onChange={setStage} />
            ) : (
              <DueChip due={due} onChange={setDue} />
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-badge font-semibold transition-colors",
                canSubmit
                  ? "bg-primary text-primary-foreground shadow-[var(--sh-stk)]"
                  : "cursor-not-allowed bg-elev text-faint",
                focusRing,
              )}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-label="Adding" /> : "Add"}
            </button>
          </>
        )}
      </div>

      {showChips && (
        <p
          className={cn(
            "flex items-center gap-1.5 border-t border-dashed border-line px-3 py-1.5 pl-[38px] text-caption",
            wouldLandNowhere ? "text-warn" : "text-muted",
          )}
        >
          {wouldLandNowhere && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
          {destination}
        </p>
      )}
    </form>
  );
}

function ChipButton({
  children,
  ariaLabel,
}: {
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border border-line-2 bg-paper-2 py-1 pl-2 pr-1.5 text-caption font-medium text-ink-2 hover:border-faint hover:text-ink",
        focusRing,
      )}
    >
      {children}
      <ChevronDown className="size-3" aria-hidden />
    </button>
  );
}

function OwnerChip({
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
        <ChipButton ariaLabel={`Owner: ${label}`}>
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
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
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

function DueChip({ due, onChange }: { due: WorkDuePreset; onChange: (d: WorkDuePreset) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton ariaLabel={`Due: ${WORK_DUE_PRESET_LABELS[due]}`}>
          <Clock className="size-3.5" aria-hidden />
          {WORK_DUE_PRESET_LABELS[due]}
        </ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Due</DropdownMenuLabel>
          {WORK_DUE_PRESETS.map((p) => (
            <DropdownMenuItem key={p} onClick={() => onChange(p)}>
              {WORK_DUE_PRESET_LABELS[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StageChip({
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
        <ChipButton ariaLabel={`Stage: ${label}`}>{label}</ChipButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
