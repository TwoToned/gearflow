import { createId } from "@paralleldrive/cuid2";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Actor } from "./auth";
import { writeActivityLog } from "./audit";
import { bumpProjectCounters } from "./counters";
import { lockTierForStatus, LOCK_TIER_RANK, crossesIntoSnapshotStatus } from "./projectLocks";
import { captureProjectSnapshot } from "./projectSnapshots";
import { hasAcceptedQuote } from "./quoteState";
import { resolveAutoStatusEnabled, type AutoStatusSettingKey } from "./orgSettings";
import { autoCommitOpenSession } from "../projectUnlockSessionsWrites";

/**
 * Project status automation (#1160) — the ONE place a job's status moves on its
 * own, as a side effect of work someone already did somewhere else.
 *
 * The problem this replaces: a job's status was a field somebody had to remember
 * to change. A quote went out and the job sat at ENQUIRY; gear left the building
 * and the board still said CONFIRMED. The one exception was the returns station,
 * which had grown its own private `maybeAutoAdvanceProject` — this module is that
 * function generalised, and the returns path now calls in here rather than
 * keeping a second copy of the rules (R-3.1).
 *
 * ── Three properties that make this safe to run unattended ──
 *
 * 1. **Forward-only, from an explicit set.** Each trigger declares the exact
 *    statuses it may move a job OUT of. Nothing else is touched — a CANCELLED,
 *    COMPLETED or INVOICED job is never reopened by a warehouse scan, a job
 *    already past the target never goes backwards, and re-firing a trigger is a
 *    no-op because the `from` set no longer matches.
 * 2. **Never crosses into the HARD_LOCKED tier, and reproduces every ceremony
 *    it does cross.** COMPLETED/INVOICED are never automated — closing a job out
 *    is a human's call and there is no event that means "the work is finished".
 *
 *    CONFIRMED is the one exception, added by #1236: `PAYMENT_SETTLED`. In the
 *    business this models, payment IS the confirmation ("once it's paid, the job
 *    is on"), so refusing to automate it would leave the app's most meaningful
 *    status permanently behind the facts. It is safe because it reproduces both
 *    ceremonies `updateStatusNative` performs on that transition rather than
 *    skipping them:
 *      - the **accepted-quote gate** (#986 decision 3) — no accepted revision,
 *        no auto-advance. The manual path can override that with a justification
 *        from a narrow audience; this path has nobody to collect one from, so it
 *        fails CLOSED and leaves the job at AWAITING_PAYMENT for a human.
 *      - the **whole-project snapshot** — `crossesIntoSnapshotStatus` is checked
 *        here exactly as it is there, so an automatic confirm is as recoverable
 *        as a manual one.
 *    What it does NOT reproduce is the overbooking-impact dialog, which is a
 *    client-side advisory that never blocked a confirm anyway (see
 *    `ConfirmStatusImpactDialog`: "This is a heads-up, not a block").
 * 3. **It patches the project directly, on the authority of the gate the calling
 *    mutation already passed** — the same reasoning the returns station shipped
 *    with: routing through `updateStatusNative` would re-gate on `project:update`,
 *    which a dedicated `warehouse` role does NOT have, so the side effect would
 *    silently fail for exactly the role the station is built for. `bumpProjectCounters`,
 *    the `autoCommitOpenSession` invariant ("a session never silently spans a
 *    status change") and the lock-tier-annotated audit row are all reproduced here
 *    so an auto-advance and a manual one leave the same trail.
 *
 * Every applied move writes a `STATUS_CHANGE` audit row carrying
 * `metadata.autoAdvanceTrigger`, so "who moved this job?" is answerable and the
 * automation is filterable in the activity log.
 */

export const AUTO_STATUS_TRIGGERS = [
  "QUOTE_SENT",
  "QUOTE_ACCEPTED",
  "INVOICE_ISSUED",
  "PAYMENT_SETTLED",
  "PREP_STARTED",
  "ALL_CHECKED_OUT",
  "ALL_RETURNED",
] as const;

export type AutoStatusTrigger = (typeof AUTO_STATUS_TRIGGERS)[number];

/** The project-status union, taken from the schema rather than re-declared. */
type ProjectStatus = NonNullable<Doc<"projects">["status"]>;

interface AutoStatusRule {
  /** The status this trigger advances to. */
  readonly to: ProjectStatus;
  /** The ONLY statuses it may advance out of. Anything else is left alone. */
  readonly from: readonly string[];
  /** Org opt-out switch (src/lib/project-status-automation.ts). */
  readonly settingKey: AutoStatusSettingKey;
  /** Audit-row tail: "Auto-advanced to X — {because}". */
  readonly because: string;
}

/** The rule table. Adding a trigger is a change HERE and nowhere else. */
export const AUTO_STATUS_RULES: Record<AutoStatusTrigger, AutoStatusRule> = {
  QUOTE_SENT: {
    to: "QUOTED",
    from: ["ENQUIRY", "QUOTING"],
    settingKey: "quoteSent",
    because: "a quote was sent to the client",
  },
  // ── #1236, the money phase ────────────────────────────────────────────────
  // Two ways in, one way out. A job is "agreed but unpaid" either because the
  // client accepted the quote or because an invoice went out (some jobs skip
  // straight to a full invoice with no accept step) — whichever happens first
  // moves it, and the second is then a no-op because the `from` set no longer
  // matches. Payment is the single way forward out of it.
  QUOTE_ACCEPTED: {
    to: "AWAITING_PAYMENT",
    from: ["ENQUIRY", "QUOTING", "QUOTED"],
    settingKey: "quoteAccepted",
    because: "the client accepted the quote",
  },
  INVOICE_ISSUED: {
    to: "AWAITING_PAYMENT",
    from: ["ENQUIRY", "QUOTING", "QUOTED"],
    settingKey: "invoiceIssued",
    because: "an invoice was issued",
  },
  PAYMENT_SETTLED: {
    to: "CONFIRMED",
    from: ["AWAITING_PAYMENT"],
    settingKey: "paymentSettled",
    because: "an invoice was paid in full",
  },
  PREP_STARTED: {
    to: "PREPPING",
    from: ["CONFIRMED"],
    settingKey: "prepStarted",
    because: "the warehouse started prepping",
  },
  ALL_CHECKED_OUT: {
    to: "CHECKED_OUT",
    from: ["CONFIRMED", "PREPPING"],
    settingKey: "allCheckedOut",
    because: "the last packed item was deployed",
  },
  ALL_RETURNED: {
    to: "RETURNED",
    from: ["CHECKED_OUT", "ON_SITE"],
    settingKey: "allReturned",
    because: "the last outstanding item was returned",
  },
};

/** Any line still sitting packed on the dock, waiting to go out.
 *
 *  This is the server-side twin of `isInPreppedStage`
 *  (src/components/warehouse/warehouse-types.ts) reduced to its core: a line is
 *  waiting iff it is PACKED and has not left / come back / been cancelled.
 *  Deliberately keyed off `prepStatus` rather than line `type`: a services /
 *  labour / transport / sale line is never PACKED, so it can't hold a job at
 *  PREPPING forever — which a "is every EQUIPMENT line CHECKED_OUT?" test would.
 *
 *  Two indexed range scans, not a whole-project collect: a packed-and-waiting
 *  line rolls up to `PREPPED` (`deriveOrderLineStatus`) when it is unit-backed,
 *  and stays `CONFIRMED` on the paths that patch the line row directly
 *  (`checkRecordOps`' kit prep). Both shapes are checked. */
async function anyPackedWaiting(ctx: MutationCtx, projectId: string): Promise<boolean> {
  for (const status of ["PREPPED", "CONFIRMED"] as const) {
    const waiting = await ctx.db
      .query("projectLineItems")
      .withIndex("by_projectId_status", (q) => q.eq("projectId", projectId).eq("status", status))
      .filter((q) => q.eq(q.field("prepStatus"), "PACKED"))
      .first();
    if (waiting) return true;
  }
  return false;
}

/** Existence check only (never a collect) — one CHECKED_OUT line is enough. */
async function anyCheckedOut(ctx: MutationCtx, projectId: string): Promise<boolean> {
  const out = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId_status", (q) => q.eq("projectId", projectId).eq("status", "CHECKED_OUT"))
    .first();
  return out != null;
}

/**
 * The extra condition beyond "the status is in the trigger's `from` set".
 *
 * `QUOTE_SENT`/`PREP_STARTED` fire on the event itself — the caller only reaches
 * here because the thing happened — so their `from` set IS the whole condition,
 * which also makes them idempotent (the second item prepped finds the job already
 * at PREPPING). The two "all" triggers have to look at the rest of the project.
 */
async function conditionMet(
  ctx: MutationCtx,
  trigger: AutoStatusTrigger,
  orgId: string,
  projectId: string,
  now: number,
): Promise<boolean> {
  switch (trigger) {
    case "QUOTE_SENT":
    case "QUOTE_ACCEPTED":
    case "INVOICE_ISSUED":
    case "PREP_STARTED":
      return true;
    case "PAYMENT_SETTLED":
      // Fails CLOSED without an accepted revision — see property 2 above. The
      // caller has already established that an invoice reached PAID; this is the
      // gate the MANUAL confirm would have hit, and the automation must not be a
      // way around it.
      return await hasAcceptedQuote(ctx, orgId, projectId, now);
    case "ALL_CHECKED_OUT":
      // Nothing left on the dock AND something actually went out — otherwise a
      // job whose gear was never prepped would "finish" deploying instantly.
      return !(await anyPackedWaiting(ctx, projectId)) && (await anyCheckedOut(ctx, projectId));
    case "ALL_RETURNED":
      return !(await anyCheckedOut(ctx, projectId));
  }
}

/**
 * The same whole-project snapshot `updateStatusNative` takes on the same
 * crossings (#792) — an automatic confirm has to be exactly as recoverable as a
 * manual one. Reads the project back AFTER the status patch so the snapshot's
 * own `project` entry carries the new status too; `statusFrom`/`statusTo` record
 * the transition separately.
 */
async function captureIfCrossing(
  ctx: MutationCtx,
  a: {
    orgId: string;
    projectRef: Id<"projects">;
    from: string;
    to: string;
    actor: Actor;
    now: number;
  },
): Promise<void> {
  if (!crossesIntoSnapshotStatus(a.from, a.to)) return;
  const patched = await ctx.db.get(a.projectRef);
  if (!patched) return;
  await captureProjectSnapshot(ctx, {
    orgId: a.orgId,
    project: patched,
    reason: a.to as "CONFIRMED" | "COMPLETED",
    statusFrom: a.from,
    statusTo: a.to,
    actor: a.actor,
    now: a.now,
  });
}

/**
 * Advance `projectId` if `trigger`'s rule says so. Returns the new status when it
 * moved the job, `null` otherwise (wrong status, org opted out, condition not met,
 * template, or the project is gone).
 *
 * Call it at the END of the mutation that did the real work, once — never inside a
 * per-item loop, and never before the writes it inspects have landed.
 */
export async function maybeAutoAdvanceProjectStatus(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string; trigger: AutoStatusTrigger; actor: Actor; now: number },
): Promise<string | null> {
  const rule = AUTO_STATUS_RULES[a.trigger];

  const project = await ctx.db
    .query("projects")
    .withIndex("by_cuid", (q) => q.eq("id", a.projectId))
    .first();
  // by_cuid is a GLOBAL index — org-check the row, never the caller (R-8.4.3).
  if (!project || project.organizationId !== a.orgId) return null;
  if (project.isTemplate) return null;

  const from = project.status ?? "";
  if (!rule.from.includes(from)) return null;
  if (!(await resolveAutoStatusEnabled(ctx, a.orgId, rule.settingKey))) return null;
  if (!(await conditionMet(ctx, a.trigger, a.orgId, a.projectId, a.now))) return null;

  await ctx.db.patch(project._id, { status: rule.to, updatedAt: a.now });
  await bumpProjectCounters(ctx, a.orgId, project, { ...project, status: rule.to });

  await captureIfCrossing(ctx, { orgId: a.orgId, projectRef: project._id, from, to: rule.to, actor: a.actor, now: a.now });

  // Same invariant updateStatusNative enforces: an unlock session never silently
  // spans a status change. (The pre-#1160 returns auto-advance skipped this — a
  // finance session left open across CHECKED_OUT → RETURNED straddled two tiers.)
  await autoCommitOpenSession(ctx, a.orgId, a.projectId, project.projectNumber, a.actor, a.now);

  const fromTier = lockTierForStatus(from);
  const toTier = lockTierForStatus(rule.to);
  const tierDelta = LOCK_TIER_RANK[toTier] - LOCK_TIER_RANK[fromTier];
  const lockTierSuffix =
    tierDelta > 0 ? ` — project locked (${toTier})` : tierDelta < 0 ? ` — project unlocked (${toTier})` : "";

  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: a.orgId,
    action: "STATUS_CHANGE",
    entityType: "project",
    entityId: project.id,
    entityName: project.projectNumber,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: `Auto-advanced to ${rule.to} — ${rule.because}${lockTierSuffix}`,
    details: { from, to: rule.to },
    metadata: {
      autoAdvanceTrigger: a.trigger,
      statusFrom: from,
      statusTo: rule.to,
      lockTierFrom: fromTier,
      lockTierTo: toTier,
    },
    projectId: project.id,
    createdAt: a.now,
  });

  return rule.to;
}

/**
 * Undo ONE auto-advance, from the audit row that recorded it.
 *
 * Used by `agentRevert.revertAgentWindow`: reversing an agent's deploy that also
 * tripped `ALL_CHECKED_OUT` has to put the status back too, or the revert leaves a
 * job sitting at Deployed with nothing deployed. Only ever undoes an AUTOMATIC
 * move — a deliberate `updateStatusNative` call carries no `autoAdvanceTrigger`
 * and is left alone, because reverting one has its own audience + justification
 * rules (#792) this path deliberately does not re-implement.
 *
 * Refuses if the project has moved on since (`statusTo` no longer current):
 * whatever is there now is someone's later decision, and stamping an older value
 * over it would be a silent data loss, not a revert.
 */
export async function revertAutoAdvance(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string; metadata: unknown; now: number },
): Promise<{ from: string; to: string } | { skipReason: string }> {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.autoAdvanceTrigger !== "string") {
    return { skipReason: "Only an automatic status advance can be reverted from here." };
  }
  const statusFrom = meta.statusFrom;
  const statusTo = meta.statusTo;
  if (typeof statusFrom !== "string" || typeof statusTo !== "string") {
    return { skipReason: "This status entry doesn't record what it moved between." };
  }

  const project = await ctx.db
    .query("projects")
    .withIndex("by_cuid", (q) => q.eq("id", a.projectId))
    .first();
  if (!project || project.organizationId !== a.orgId) return { skipReason: "Project not found." };
  if ((project.status ?? "") !== statusTo) {
    return { skipReason: `The project has since moved to ${project.status ?? "no status"}.` };
  }

  await ctx.db.patch(project._id, { status: statusFrom as ProjectStatus, updatedAt: a.now });
  await bumpProjectCounters(ctx, a.orgId, project, { ...project, status: statusFrom as ProjectStatus });
  return { from: statusTo, to: statusFrom };
}
