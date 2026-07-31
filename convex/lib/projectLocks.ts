import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertStrLen } from "./fieldGuards";
import { currentRevisionQuoteStatus, projectRevision, type EffectiveQuoteStatus } from "./quoteState";

/**
 * Project lifecycle lock-tier module (#957) — the SINGLE source of truth for the
 * status → lock-tier boundary shared by #791 (finance soft-lock), #793 (ON_SITE
 * justification gate), and #792 (COMPLETED hard-lock). Every gate site across
 * convex/projectWrites.ts, lineItemWrites.ts, projectGroupsWrites.ts,
 * projectCategoriesWrites.ts, projectServicesWrites.ts, crewAssignmentsWrites.ts
 * calls `assertLifecycleGuard` from here — a second hand-maintained copy of the
 * tier boundary would be a defect even if in sync (POLICY.md R-3.1).
 *
 * Tier table (see #957 tracking issue):
 *   ENQUIRY / QUOTING / QUOTED           → OPEN            (nothing gated)
 *   CONFIRMED / PREPPING / CHECKED_OUT   → FINANCE_LOCKED  (money fields gated)
 *   ON_SITE / RETURNED                   → JUSTIFY         (+ structural mutations
 *                                                            need confirm+justify)
 *   COMPLETED / INVOICED                 → HARD_LOCKED     (everything gated,
 *                                                            no per-edit path)
 *   CANCELLED                            → OPEN            (ungated — #957 open Q)
 *
 * #988 (Phase C, part of #985's finance version-control program) folds ONE
 * more input into this same resolver rather than adding a second lock: a
 * `resolveLockTier({ status, quoteState })` on top of `lockTierForStatus`,
 * where an OPEN-status project whose current quote revision has been sent
 * escalates to FINANCE_LOCKED too. See `resolveLockTier` below.
 */

export type LockTier = "OPEN" | "FINANCE_LOCKED" | "JUSTIFY" | "HARD_LOCKED";

const TIER_BY_STATUS: Record<string, LockTier> = {
  ENQUIRY: "OPEN",
  QUOTING: "OPEN",
  QUOTED: "OPEN",
  CONFIRMED: "FINANCE_LOCKED",
  PREPPING: "FINANCE_LOCKED",
  CHECKED_OUT: "FINANCE_LOCKED",
  ON_SITE: "JUSTIFY",
  RETURNED: "JUSTIFY",
  COMPLETED: "HARD_LOCKED",
  INVOICED: "HARD_LOCKED",
  CANCELLED: "OPEN",
};

/** Resolve a project's lock tier from its `status`. Templates and statusless
 *  (in-progress create) rows read as OPEN. */
export function lockTierForStatus(status: string | null | undefined): LockTier {
  if (!status) return "OPEN";
  return TIER_BY_STATUS[status] ?? "OPEN";
}

/** Restrictiveness order of the four tiers — the single place that answers
 *  "did this transition make the project MORE or LESS locked", so callers
 *  (e.g. `projectWrites.updateStatusNative`'s activity-log summary) don't grow
 *  a second hand-maintained ordering of `LockTier` (R-3.1). */
export const LOCK_TIER_RANK: Record<LockTier, number> = {
  OPEN: 0,
  FINANCE_LOCKED: 1,
  JUSTIFY: 2,
  HARD_LOCKED: 3,
};

export function isConfirmedOrLater(status: string | null | undefined): boolean {
  return lockTierForStatus(status) !== "OPEN";
}

// ─── #988 (Phase C) — the quote-send lock folds into the SAME tier resolver ──

/** Why the effective tier is what it is — lets the UI explain itself and offer
 *  the right exit (Phase E). `STATUS` covers both "nothing is locked" and
 *  every status-driven tier (FINANCE_LOCKED/JUSTIFY/HARD_LOCKED via CONFIRMED+);
 *  `QUOTE_SENT` is the one new case — an OPEN-status project (ENQUIRY/QUOTING/
 *  QUOTED) whose current revision has already gone out. */
export type LockTierReason = "STATUS" | "QUOTE_SENT";

export interface ResolveLockTierResult {
  tier: LockTier;
  reason: LockTierReason;
}

/**
 * A quote state that keeps pricing OPEN when the status tier is itself OPEN:
 * nothing has ever been sent for this revision (`null`), or the current
 * revision is a fresh, unsent `DRAFT`. Every other state — `SENT`, `ACCEPTED`,
 * `DECLINED`, `SUPERSEDED`, `EXPIRED` — means this exact revision has already
 * gone out and is either still live or terminal; decision 2 ("cutting a new
 * version is the unlock") makes `newVersionNative` the ONLY way out of any of
 * them, so all five raise the tier identically. `DECLINED`/`SUPERSEDED` are
 * defensive completeness — a project's CURRENT revision is never SUPERSEDED in
 * normal flow (only an older, already-superseded one is), and a declined
 * revision still needs a new version rather than silent re-editing.
 */
function quoteStateKeepsOpen(quoteState: EffectiveQuoteStatus | null | undefined): boolean {
  return quoteState == null || quoteState === "DRAFT";
}

/**
 * `lockTierForStatus(status)` → `resolveLockTier({ status, quoteState })` — the
 * quote-send lock (decision 2, #985) is not a second lock mechanism, it is a
 * second INPUT to this one. `quoteState` is the CURRENT revision's quote status
 * (`quoteState.ts#currentRevisionQuoteStatus`, or an already-resolved
 * `effectiveQuoteStatus` for a caller that has one to hand, e.g. a read query
 * with real EXPIRED detection).
 *
 * Monotonic by construction: a quote state can only ever raise OPEN to
 * FINANCE_LOCKED, never touch (let alone lower) FINANCE_LOCKED/JUSTIFY/
 * HARD_LOCKED — those are already at or above FINANCE_LOCKED from status alone.
 * `LockTier` values are unchanged, so every existing `FINANCIALS_LOCKED` /
 * `PROJECT_LOCKED` code and toast mapping still applies untouched.
 */
export function resolveLockTier(input: {
  status: string | null | undefined;
  quoteState?: EffectiveQuoteStatus | null;
}): ResolveLockTierResult {
  const statusTier = lockTierForStatus(input.status);
  if (statusTier !== "OPEN") return { tier: statusTier, reason: "STATUS" };
  if (quoteStateKeepsOpen(input.quoteState)) return { tier: "OPEN", reason: "STATUS" };
  return { tier: "FINANCE_LOCKED", reason: "QUOTE_SENT" };
}

/** The linear pipeline order (CANCELLED is off-pipeline, reachable from any
 *  status — see FEATUREDOCS/10 Status Flow). Used only to detect a snapshot-
 *  worthy transition and the HARD_LOCKED-revert boundary, not for RBAC. */
const STATUS_ORDER = [
  "ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED", "PREPPING", "CHECKED_OUT",
  "ON_SITE", "RETURNED", "COMPLETED", "INVOICED",
] as const;

/** True for any transition that lands exactly on CONFIRMED or COMPLETED —
 *  forward advance OR a revert-then-re-advance ("re-crossing"). Each crossing
 *  takes a NEW snapshot (#792: "versioned list, never overwritten"). */
export function crossesIntoSnapshotStatus(from: string | null | undefined, to: string): boolean {
  return from !== to && (to === "CONFIRMED" || to === "COMPLETED");
}

/** Whether `to` is strictly forward of `from` in the pipeline order. CANCELLED
 *  (or any unrecognised status) never counts as forward — it's off-pipeline. */
export function isForwardStatusMove(from: string | null | undefined, to: string): boolean {
  const fi = STATUS_ORDER.indexOf((from ?? "") as (typeof STATUS_ORDER)[number]);
  const ti = STATUS_ORDER.indexOf(to as (typeof STATUS_ORDER)[number]);
  if (fi === -1 || ti === -1) return false;
  return ti > fi;
}

/** True when `from → to` leaves the HARD_LOCKED tier (i.e. reverts out of
 *  COMPLETED/INVOICED to something earlier) — COMPLETED→INVOICED stays HARD_LOCKED
 *  on both ends and is NOT a revert (#792: "stays a normal forward move"). */
export function isRevertOutOfHardLock(from: string | null | undefined, to: string): boolean {
  return lockTierForStatus(from) === "HARD_LOCKED" && lockTierForStatus(to) !== "HARD_LOCKED";
}

// ─── Locked field lists (the authoritative export #791 asks for) ────────────

/** Project-level fields soft-locked at FINANCE_LOCKED+ (recalc INPUTS — the recalc
 *  OUTPUTS in PROJECT_MONEY_ANCHORS (projectWrites.ts) are already unconditionally
 *  stripped and never reach here). WS1 (#940): `depositPercent` moved off the
 *  project entirely (now the CLIENT payment profile); `depositPaid`/
 *  `invoicedTotal` moved from "locked project input" to recalc-owned
 *  PROJECT_MONEY_ANCHORS (derived from invoices) — neither needs a lock-tier
 *  entry here anymore, same as equipmentRevenue/total/etc. never did. */
export const LOCKED_PROJECT_FIELDS = [
  "taxRate",
  "discountPercent",
] as const;

// `discountMode` (#1012) travels with `discount` in both lists: it is the entry
// shape of that exact number, so a FINANCIAL-scope revert that restores the
// dollar amount must restore how it was entered too — otherwise a reverted line
// keeps printing "%" for a `$` discount (or vice versa).
export const LOCKED_GROUP_FIELDS = ["price", "discount", "discountMode", "rentalPeriod", "rentalQuantity"] as const;

export const LOCKED_LINE_ITEM_FIELDS = ["unitPrice", "discount", "discountMode", "duration"] as const;

/** `costTotal` is locked only for CREW-LESS services — a crew-attached service's
 *  costTotal keeps auto-deriving from the crew rate table even post-CONFIRMED
 *  (assigning crew at known rates is a deliberate act; see recalcServiceCostFromCrew).
 *  Callers must check `hasCrew` themselves before applying this list. */
export const LOCKED_SERVICE_FIELDS = ["costTotal", "billableToClient"] as const;

export const LOCKED_CREW_FIELDS = ["rateOverride", "rateType", "estimatedHours"] as const;

// ─── Open unlock session lookup ──────────────────────────────────────────────

/** The project's open unlock session (FINANCIAL or FULL scope), if any. At most
 *  one OPEN row per project is enforced by projectUnlockSessionsWrites.openNative. */
export async function getOpenUnlockSession(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
): Promise<Doc<"projectUnlockSessions"> | null> {
  const session = await ctx.db
    .query("projectUnlockSessions")
    .withIndex("by_projectId_outcome", (q) => q.eq("projectId", projectId).eq("outcome", "OPEN"))
    .first();
  // by_projectId_outcome is not org-scoped in its key — re-check org (R-8.4.3).
  if (!session || session.organizationId !== orgId) return null;
  return session;
}

/** Whether new adds should default their price/cost to $0 instead of the normal
 *  auto-price/rate autofill — true once locked and NO session is open (any open
 *  session — FINANCIAL or FULL — puts the PM deliberately in pricing mode). */
export function shouldDefaultToZero(tier: LockTier, openSession: Doc<"projectUnlockSessions"> | null): boolean {
  return tier !== "OPEN" && openSession == null;
}

/** The `pricedUnderLock` field value for a fresh group/line-item insert —
 *  `true` when `defaultToZero` forced this row's price to $0/unset, `undefined`
 *  (absent, Convex's "false") otherwise. ONE helper so every insert site
 *  derives the same value instead of re-deriving `defaultToZero || undefined`
 *  inline at each call site (R-3.1) — also keeps that branch out of each
 *  insert mutation's own cyclomatic-complexity count (R-3.6 ratchet). */
export function pricedUnderLockOnInsert(defaultToZero: boolean | undefined): true | undefined {
  return defaultToZero || undefined;
}

// ─── The shared guard (#793's `assertLifecycleGuard`) ────────────────────────

export type LifecycleGuardKind = "financial" | "structural";

export interface LifecycleGuardOptions {
  /** Which locked-field family this write touches. "financial" routes through
   *  #791/#792's unlock-session flow; "structural" is #793's per-edit justify
   *  gate (JUSTIFY tier only — pre-ON_SITE structural edits are ungated, and
   *  HARD_LOCKED escalates straight to a FULL-session requirement). */
  kind: LifecycleGuardKind;
  /** Caller-supplied justification text (#793), checked only when the tier
   *  requires it and no session is already open. */
  justification?: string | null;
  /**
   * Skip the #988 quote-derived escalation and resolve the tier from STATUS
   * alone. Reserved for `quotesWrites.ts`'s `sendNative`/`newVersionNative` —
   * the two mutations that raise/cut the quote-derived lock are also the
   * SANCTIONED EXIT from it ("cutting a new version is the unlock", decision
   * 2), so gating them against their own revision's not-yet-superseded state
   * would be a chicken-and-egg deadlock: `newVersionNative` runs while the
   * current revision is still the live `SENT` quote it's about to move past.
   * No other gate site should ever set this — the entire point of #988 is
   * that the other ~25 sites pick up the quote lock with ZERO changes.
   */
  bypassQuoteLock?: boolean;
}

export interface LifecycleGuardResult {
  tier: LockTier;
  /** Why `tier` is what it is (#988) — STATUS-driven or raised by a sent quote
   *  on an otherwise-OPEN project. Lets the UI explain itself and offer the
   *  right exit instead of a bare "locked". */
  reason: LockTierReason;
  openSession: Doc<"projectUnlockSessions"> | null;
  /** True when a $0 default should be applied to a NEW add (see shouldDefaultToZero). */
  defaultToZero: boolean;
}

/** #793's bounds for every "explain why you're overriding this" free-text field.
 *  EXPORTED so the hard-lock-revert gate and #986's acceptance-gate override read
 *  the same two numbers instead of hand-copying them (R-3.1) — they were already
 *  duplicated inline in `projectWrites.updateStatusNative` before #986. */
export const JUSTIFICATION_BOUNDS = { min: 10, max: 1000 } as const;

/**
 * Require a bounded justification, throwing `JUSTIFICATION_REQUIRED` with a
 * caller-supplied explanation of what is being justified. Returns the trimmed
 * text so the caller can persist exactly what was validated.
 */
export function requireJustification(justification: string | null | undefined, message: string): string {
  const trimmed = justification?.trim();
  if (!trimmed || trimmed.length < JUSTIFICATION_BOUNDS.min) {
    throw new ConvexError({ code: "JUSTIFICATION_REQUIRED", message });
  }
  assertStrLen(trimmed, "justification", JUSTIFICATION_BOUNDS);
  return trimmed;
}

/**
 * The one call every gate site makes (#793's "one shared guard helper... so
 * every gate site is one call"). Encodes the full #957 precedence table:
 *  - OPEN: always passes.
 *  - HARD_LOCKED: requires an open FULL session, full stop — no per-edit path.
 *  - FINANCE_LOCKED financial write: requires an open session (either scope).
 *  - FINANCE_LOCKED structural write: passes ungated (structural gate starts at
 *    ON_SITE, not CONFIRMED — #793 scope).
 *  - JUSTIFY financial write: requires an open session (span of #791 continues
 *    through ON_SITE+) — never ALSO prompted by the structural dialog.
 *  - JUSTIFY structural write: open session suppresses the prompt (no double-
 *    prompt); otherwise requires a bounded justification.
 *
 * #988 (Phase C) folds one more input into the SAME tier: an OPEN-status
 * project (ENQUIRY/QUOTING/QUOTED) whose current revision has already been
 * sent resolves to FINANCE_LOCKED too (`resolveLockTier`) — every rule above
 * still applies unchanged, just against a tier that can now come from either
 * source. The quote lookup only runs when the status tier is itself OPEN
 * (any higher tier already dominates — monotonic), so this adds no DB read to
 * the CONFIRMED+/ON_SITE+/COMPLETED+ paths that make up most gated writes.
 *
 * Throws `ConvexError` with a stable `code` the client can branch on:
 * `PROJECT_LOCKED` | `FINANCIALS_LOCKED` | `JUSTIFICATION_REQUIRED`.
 */
export async function assertLifecycleGuard(
  ctx: MutationCtx,
  project: Pick<Doc<"projects">, "id" | "organizationId" | "status" | "revision">,
  opts: LifecycleGuardOptions,
): Promise<LifecycleGuardResult> {
  const statusTier = lockTierForStatus(project.status);
  const quoteState =
    statusTier === "OPEN" && !opts.bypassQuoteLock
      ? await currentRevisionQuoteStatus(ctx, project.organizationId, project.id, projectRevision(project))
      : null;
  const { tier, reason } = resolveLockTier({ status: project.status, quoteState });
  if (tier === "OPEN") return { tier, reason, openSession: null, defaultToZero: false };

  const openSession = await getOpenUnlockSession(ctx, project.organizationId, project.id);
  const defaultToZero = shouldDefaultToZero(tier, openSession);

  if (tier === "HARD_LOCKED") {
    if (openSession?.scope === "FULL") return { tier, reason, openSession, defaultToZero };
    throw new ConvexError({
      code: "PROJECT_LOCKED",
      message: "This project is completed and hard-locked. Open a full unlock session to make changes.",
    });
  }

  if (opts.kind === "financial") {
    if (openSession) return { tier, reason, openSession, defaultToZero };
    throw new ConvexError({
      code: "FINANCIALS_LOCKED",
      message:
        reason === "QUOTE_SENT"
          ? "This quote has already been sent, which locks pricing. Create a new quote version to change prices, or open an unlock session."
          : "This project's financials are locked. Open an unlock session (Financials tab) to edit money fields.",
    });
  }

  // structural
  if (tier === "FINANCE_LOCKED") {
    // #793's structural gate doesn't start until ON_SITE — CONFIRMED/PREPPING/
    // CHECKED_OUT (or an OPEN-status project whose quote was sent) only gate
    // financial fields (handled above).
    return { tier, reason, openSession, defaultToZero };
  }

  // tier === "JUSTIFY"
  if (openSession) return { tier, reason, openSession, defaultToZero }; // no double-prompt
  const justification = opts.justification?.trim();
  if (!justification || justification.length < JUSTIFICATION_BOUNDS.min) {
    throw new ConvexError({
      code: "JUSTIFICATION_REQUIRED",
      message: `This project is ${project.status} — describe why this change is needed (at least ${JUSTIFICATION_BOUNDS.min} characters).`,
    });
  }
  assertStrLen(justification, "justification", JUSTIFICATION_BOUNDS);
  return { tier, reason, openSession, defaultToZero };
}

/** Persist the justification onto an activity-log write's `metadata` (#793:
 *  "in the same transaction as the domain change, never a UI-only confirm").
 *  Folds in the open session id when present (#791/#792: "every financial
 *  write's audit row carries metadata.unlockSessionId"). */
export function lifecycleAuditMetadata(
  result: Pick<LifecycleGuardResult, "tier" | "openSession">,
  justification?: string | null,
): Record<string, unknown> | undefined {
  const trimmed = justification?.trim();
  if (!trimmed && !result.openSession) return undefined;
  return {
    ...(trimmed ? { justification: trimmed, lockTier: result.tier } : {}),
    ...(result.openSession ? { unlockSessionId: result.openSession.id } : {}),
  };
}

// ─── HARD_LOCKED audience (#792: org admins/owners + the project's assigned PMs) ─

/** Whether `userId` may open/act inside a FULL unlock session on this project:
 *  org role admin/owner, OR present in the project's `projectManagers` set.
 *  Server-checked — narrower than the general `project:update` permission. */
export async function isHardLockOverrideAllowed(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  if (member && (member.role === "owner" || member.role === "admin")) return true;

  const pm = await ctx.db
    .query("projectManagers")
    .withIndex("by_projectId_userId", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first();
  return pm != null && pm.organizationId === orgId;
}

export async function requireHardLockOverrideAllowed(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const allowed = await isHardLockOverrideAllowed(ctx, orgId, projectId, userId);
  if (!allowed) {
    throw new ConvexError({
      code: "FORBIDDEN_HARD_LOCK_OVERRIDE",
      message: "Only org admins/owners or this project's assigned PM(s) can open a full unlock session.",
    });
  }
}
