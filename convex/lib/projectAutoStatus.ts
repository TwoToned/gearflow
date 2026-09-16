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
import { assertWritesEnabled } from "./writeGuard";

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
  // Both warehouse triggers accept AWAITING_PAYMENT as a `from`. Without it the
  // money phase is a one-way door for any org that reconciles payments in Xero
  // rather than recording them in Flow (the product's stated model — see
  // FEATUREDOCS/66): the job enters AWAITING_PAYMENT on accept, PAYMENT_SETTLED
  // never fires because no `payments` row is ever written, and no downstream
  // trigger would take it. Physical work is now the second way out.
  //
  // This skips CONFIRMED, and with it the confirm snapshot — deliberately, and
  // not a new hole: `crossesIntoSnapshotStatus` only ever fires on landing
  // exactly at CONFIRMED, so the manual `updateStatusNative` path has always
  // skipped it the same way on a QUOTED → PREPPING move. The automation does
  // what a human does, no more.
  PREP_STARTED: {
    to: "PREPPING",
    from: ["AWAITING_PAYMENT", "CONFIRMED"],
    settingKey: "prepStarted",
    because: "the warehouse started prepping",
  },
  ALL_CHECKED_OUT: {
    to: "CHECKED_OUT",
    from: ["AWAITING_PAYMENT", "CONFIRMED", "PREPPING"],
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

/**
 * Is this row still physically in the building?
 *
 * The line-level twin of the warehouse page's own stage test
 * (`isInPickPrepStage || isInPreppedStage`, src/components/warehouse/warehouse-types.ts),
 * reduced to what a single line row can answer without loading its units.
 *
 * Scoped to EQUIPMENT because only physically picked gear ever leaves the
 * warehouse: a SERVICE / LABOUR / TRANSPORT / MISC / SALE line sits at
 * CONFIRMED for the life of the job and would pin the project at PREPPING
 * forever. Container rows are warehouse bookkeeping, and a sub-hire GROUP
 * wrapper is never deployed itself (its children are), so both are skipped
 * exactly the way the warehouse page skips them.
 *
 * This replaces an "is anything still PACKED?" test, which was wrong twice:
 *   - a partially deployed bulk line rolls up to `{ status: CHECKED_OUT,
 *     prepStatus: PACKED }` (`deriveOrderLineStatus` is a `some`), so deploying
 *     one of three units read as "nothing left packed" and flipped the job with
 *     two units still on the dock; and
 *   - it was vacuously true for gear nobody had prepped, so deploying one item
 *     out of ten never-prepped lines flipped the whole job too.
 * Both are now positive tests — a row is out when its ordered quantity has
 * actually left — rather than the absence of a PACKED marker.
 *
 * The cheap field tests run first and the one test that costs a read runs last,
 * so the overwhelming majority of rows are decided without touching the db.
 */
async function isStillInBuilding(
  ctx: MutationCtx,
  line: Doc<"projectLineItems">,
  orgId: string,
): Promise<boolean> {
  if ((line.type ?? "EQUIPMENT") !== "EQUIPMENT") return false;
  if (line.isContainerLineItem) return false;
  if (!hasQuantityLeftToDeploy(line)) return false;
  return !(await isSubHireWrapper(ctx, line, orgId));
}

/** Does this row still have ordered quantity that hasn't left the building? */
function hasQuantityLeftToDeploy(line: Doc<"projectLineItems">): boolean {
  const status = line.status ?? "";
  if (status === "CANCELLED" || status === "RETURNED") return false;
  const qty = line.quantity ?? 0;
  if (qty <= 0) return false; // exhausted original left behind by a prep-split
  if (status !== "CHECKED_OUT") return true;
  // Partially deployed. `checkedOutQuantity` ABSENT (not zero) means no per-unit
  // counter was ever kept for this row — a legacy deploy, or a path that patches
  // the line straight to CHECKED_OUT — so the status is all there is to go on and
  // we take it. Prep writes an explicit `0`, so absent and zero differ here.
  const out = line.checkedOutQuantity;
  if (out == null) return false;
  return out + (line.returnedQuantity ?? 0) < qty;
}

/** A sub-hire GROUP wrapper — the row the warehouse page hides because its
 *  children show individually, and which is therefore never deployed itself.
 *  The child lookup is indexed and gated behind three free field tests, so it
 *  only runs for the handful of rows that could be one. `by_parentLineItemId`
 *  is a GLOBAL index — org-check the row it returns (R-8.4.3). */
async function isSubHireWrapper(
  ctx: MutationCtx,
  line: Doc<"projectLineItems">,
  orgId: string,
): Promise<boolean> {
  if (line.subHireId == null || line.isKitChild || line.kitId) return false;
  const child = await ctx.db
    .query("projectLineItems")
    .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", line.id))
    .first();
  return child != null && child.organizationId === orgId;
}

/**
 * The whole `ALL_CHECKED_OUT` question in ONE indexed scan of the project's
 * lines, org-filtered (`by_projectId` is a GLOBAL index — R-8.4.3).
 *
 * Streamed rather than collected, and it returns the moment it finds a row still
 * in the building: at that point the trigger cannot fire whatever the remaining
 * rows say, so reading them would be waste. Collecting the whole list here would
 * also push the repo's whole-count ratchet over its baseline
 * (scripts/collect-ratchet.mjs), and streaming is the better read anyway.
 *
 * The `anyOut` half is what stops a job with no gear on it from "finishing"
 * deploying; it is only consulted when nothing is left in the building, which is
 * exactly when the loop has run to completion and the flag is final.
 */
async function allDeployableGearIsOut(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  let anyOut = false;
  for await (const line of ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))) {
    if (line.organizationId !== orgId) continue;
    if (line.status === "CHECKED_OUT") anyOut = true;
    if (await isStillInBuilding(ctx, line, orgId)) return false;
  }
  return anyOut;
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
      // Nothing deployable left in the building AND something actually went out
      // (a job with no EQUIPMENT lines at all must not "finish" deploying).
      return await allDeployableGearIsOut(ctx, orgId, projectId);
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

  // The status patch belongs to the `project` write domain, not to whichever
  // domain the CALLING mutation gated on (quote / invoice / warehouse). Without
  // this, `disabledDomains: ["project"]` — the emergency brake for a runaway
  // client corrupting project rows — would still let a browser move
  // `projects.status` by sending a quote or scanning gear. Service tokens are
  // exempt inside `assertWritesEnabled`, so the requireService prep triggers are
  // unaffected.
  await assertWritesEnabled(ctx, "project");

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
  a: { orgId: string; projectId: string; metadata: unknown; actor: Actor; now: number },
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

  await auditRevert(ctx, {
    orgId: a.orgId, project, trigger: meta.autoAdvanceTrigger,
    from: statusTo, to: statusFrom, actor: a.actor, now: a.now,
  });

  return { from: statusTo, to: statusFrom };
}

/**
 * A revert is a status change like any other, and this module's whole claim is
 * that "who moved this job?" is answerable. Before this, the only trace was
 * `agentRevert`'s aggregate REVERT_AGENT_WINDOW row, which records counts — not
 * which project moved, or between which statuses. A backwards move that crosses
 * a lock tier (CONFIRMED → AWAITING_PAYMENT is FINANCE_LOCKED → OPEN) was
 * invisible in the project's own activity log, and left an unlock session
 * straddling two tiers.
 */
async function auditRevert(
  ctx: MutationCtx,
  a: {
    orgId: string;
    project: Doc<"projects">;
    trigger: string;
    from: string;
    to: string;
    actor: Actor;
    now: number;
  },
): Promise<void> {
  await autoCommitOpenSession(ctx, a.orgId, a.project.id, a.project.projectNumber, a.actor, a.now);

  const fromTier = lockTierForStatus(a.from);
  const toTier = lockTierForStatus(a.to);
  const tierDelta = LOCK_TIER_RANK[toTier] - LOCK_TIER_RANK[fromTier];
  const lockTierSuffix =
    tierDelta > 0 ? ` — project locked (${toTier})` : tierDelta < 0 ? ` — project unlocked (${toTier})` : "";

  await writeActivityLog(ctx, {
    id: createId(),
    organizationId: a.orgId,
    action: "STATUS_CHANGE",
    entityType: "project",
    entityId: a.project.id,
    entityName: a.project.projectNumber,
    userId: a.actor.userId,
    userName: a.actor.userName,
    summary: `Reverted the automatic move to ${a.from} — back to ${a.to}${lockTierSuffix}`,
    details: { from: a.from, to: a.to },
    metadata: {
      revertOfTrigger: a.trigger,
      statusFrom: a.from,
      statusTo: a.to,
      lockTierFrom: fromTier,
      lockTierTo: toTier,
    },
    projectId: a.project.id,
    createdAt: a.now,
  });
}

/**
 * Undo the auto-advance a given trigger made, when the fact behind it stops
 * being true — the counterpart to `maybeAutoAdvanceProjectStatus`.
 *
 * `revertAutoAdvance` above is driven by a specific audit row an operator picked
 * (agentRevert's window). This one is driven by the EVENT: voiding the payment
 * that settled an invoice has to walk the project back out of CONFIRMED, or a
 * mis-keyed payment confirms a job permanently — re-recording it correctly is a
 * no-op, because `PAYMENT_SETTLED`'s `from` set no longer matches.
 *
 * It only ever reverses the project's MOST RECENT status change, and only when
 * that change was this trigger's own automatic move. Anything since — a manual
 * `updateStatusNative`, a different trigger, a warehouse advance — means the
 * current status is somebody's later decision, and stamping an older value over
 * it would be silent data loss rather than a revert.
 */
export async function revertAutoAdvanceByTrigger(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string; trigger: AutoStatusTrigger; actor: Actor; now: number },
): Promise<{ from: string; to: string } | { skipReason: string }> {
  const latest = await ctx.db
    .query("activityLogs")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", a.orgId).eq("projectId", a.projectId))
    .order("desc")
    .filter((q) => q.and(q.eq(q.field("entityType"), "project"), q.eq(q.field("action"), "STATUS_CHANGE")))
    .first();
  if (!latest) return { skipReason: "This project has no recorded status change to reverse." };

  const meta = ((latest as { metadata?: unknown }).metadata ?? {}) as Record<string, unknown>;
  if (meta.autoAdvanceTrigger !== a.trigger) {
    return { skipReason: "The project's last status change wasn't this automation — leaving it alone." };
  }

  return await revertAutoAdvance(ctx, {
    orgId: a.orgId, projectId: a.projectId, metadata: meta, actor: a.actor, now: a.now,
  });
}
