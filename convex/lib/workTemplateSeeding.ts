import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import type { Actor } from "./auth";
import type { WorkStage } from "./workVocabulary";

/**
 * Work-item template seeding (#1243 Phase 1, design doc §8.2/§10 — "workTemplates").
 * Fires when a project ENTERS a lifecycle status: "Send deposit invoice", "Book
 * crew", etc. get created as real `projectTasks` rows, assigned to the project's
 * PM by default. Only `CONFIRMED` is wired so far — the design doc's only worked
 * example.
 *
 * Same call-site discipline as `convex/lib/projectAutoStatus.ts`'s
 * `maybeAutoAdvanceProjectStatus`: call ONCE at the end of the mutation that moved
 * the project into `triggerStatus`, never inside a loop, never before the status
 * write itself has landed.
 */

type OffsetFrom = "trigger" | "rentalStart" | "rentalEnd";

interface WorkTemplateDefinition {
  /** Stable per-org slug — the idempotency key (with triggerStatus) via `sourceKey`. */
  key: string;
  title: string;
  stage: WorkStage;
  offsetFrom: OffsetFrom;
  offsetDays: number;
}

// The design doc's five worked examples (§8.2), used whenever an org has no
// `workTemplates` rows of its own for a trigger status. No admin UI writes
// `workTemplates` yet (a later phase) — these are the de facto default set
// every org gets until one exists. "trigger" = relative to the moment the
// project entered the status (an immediate admin follow-up); "rentalStart"/
// "rentalEnd" = relative to the event itself ("§8.2: event -5d" etc).
export const DEFAULT_CONFIRMED_TEMPLATES: WorkTemplateDefinition[] = [
  { key: "send-deposit-invoice", title: "Send deposit invoice", stage: "quote", offsetFrom: "trigger", offsetDays: 1 },
  { key: "book-crew", title: "Book crew", stage: "prep", offsetFrom: "trigger", offsetDays: 3 },
  { key: "confirm-venue-access", title: "Confirm venue access", stage: "prep", offsetFrom: "rentalStart", offsetDays: -5 },
  { key: "truck-pack", title: "Truck pack", stage: "load_in", offsetFrom: "rentalStart", offsetDays: -1 },
  { key: "chase-balance", title: "Chase balance", stage: "close", offsetFrom: "rentalEnd", offsetDays: 7 },
];

const DAY_MS = 86_400_000;

/** Undefined when the base date the offset needs (rentalStart/rentalEnd) isn't
 *  set yet — a template that can't compute a due date is skipped, not seeded
 *  with a missing/garbage one. */
function resolveDueDate(
  def: WorkTemplateDefinition,
  now: number,
  rentalStartDate: number | undefined,
  rentalEndDate: number | undefined,
): number | undefined {
  if (def.offsetFrom === "trigger") return now + def.offsetDays * DAY_MS;
  const base = def.offsetFrom === "rentalStart" ? rentalStartDate : rentalEndDate;
  return base != null ? base + def.offsetDays * DAY_MS : undefined;
}

/** PM assignee rule (design doc §8.2): `projects.projectManagerId`, else the
 *  earliest `projectManagers` row, else unassigned (shows in the project Work
 *  card, not in anyone's Today). */
async function resolvePmAssignee(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  projectManagerId: string | undefined,
): Promise<string | undefined> {
  if (projectManagerId) return projectManagerId;
  const pms = (await ctx.db.query("projectManagers").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
    .filter((p) => p.organizationId === orgId) // by_projectId is global — re-check
    .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  return pms[0]?.userId;
}

export async function maybeSeedWorkTemplates(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string; triggerStatus: string; actor: Actor; now: number },
): Promise<void> {
  if (a.triggerStatus !== "CONFIRMED") return; // only rule wired so far

  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", a.projectId)).first();
  if (!project || project.organizationId !== a.orgId) return;

  const orgTemplates = await ctx.db
    .query("workTemplates")
    .withIndex("by_organizationId_triggerStatus", (q) => q.eq("organizationId", a.orgId).eq("triggerStatus", a.triggerStatus))
    .collect();
  const defs: WorkTemplateDefinition[] = orgTemplates.length > 0
    ? orgTemplates
        .filter((t) => t.isActive !== false)
        .map((t) => ({ key: t.id, title: t.title, stage: t.stage, offsetFrom: t.offsetFrom, offsetDays: t.offsetDays }))
    : DEFAULT_CONFIRMED_TEMPLATES;
  if (defs.length === 0) return;

  // Idempotent per (project, template key, triggerStatus) — a project that
  // already carries a template's sourceKey (re-confirmed after a revert, or a
  // re-run of this trigger) is never reseeded.
  const existingSourceKeys = new Set(
    (await ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", a.projectId)).collect())
      .filter((t) => t.organizationId === a.orgId)
      .map((t) => t.sourceKey)
      .filter((k): k is string => !!k),
  );

  const pmAssignee = await resolvePmAssignee(ctx, a.orgId, a.projectId, project.projectManagerId);

  for (const def of defs) {
    const sourceKey = `template:${def.key}:${a.triggerStatus}`;
    if (existingSourceKeys.has(sourceKey)) continue;

    await ctx.db.insert("projectTasks", {
      id: createId(),
      organizationId: a.orgId,
      projectId: a.projectId,
      title: def.title,
      status: "TODO",
      priority: "NORMAL",
      stage: def.stage,
      dueDate: resolveDueDate(def, a.now, project.rentalStartDate, project.rentalEndDate),
      assigneeUserId: pmAssignee,
      sourceKey,
      kind: "task",
      templateId: def.key,
      sortOrder: 0,
      createdAt: a.now,
      updatedAt: a.now,
    });
  }
}
