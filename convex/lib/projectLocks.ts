import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { hasPermission } from "./permissionsCore";

/**
 * Project pricing-lock module (#1230, Phase 4 of "Project versioning v2",
 * parent #1221) — the SHRUNKEN successor to the old 4-tier lock system
 * (`LockTier`/`resolveLockTier`/unlock sessions/per-edit justification),
 * deleted wholesale by this phase. The whole rule now fits in one field and
 * one guard:
 *
 * ```ts
 * projects.pricingLocked?: boolean     // absent = false
 * projects.pricingLockedAt?: number
 * projects.pricingLockedById?: string
 * ```
 *
 * Applies to the LIVE version only. A non-live `projectVersions` row (Phase
 * 1-3, `convex/versions.ts`) is writable in every field family regardless of
 * this flag — `assertPricingUnlocked` below takes the row's own `versionId`
 * for exactly this reason. Structure, plan fields and non-live-version money
 * are NEVER gated by anything in this file; only a MONEY write against the
 * project's live version can be rejected here.
 *
 * Every gate site across `projectWrites.ts`/`lineItemWrites.ts`/
 * `projectGroupsWrites.ts`/`projectServicesWrites.ts`/
 * `crewAssignmentsWrites.ts` calls `assertPricingUnlocked` — a second
 * hand-maintained copy of this check would be a defect even in sync
 * (POLICY.md R-3.1).
 *
 * **merge note (#1221 × #1236, "money phase" merge).** Main independently
 * extended the OLD 4-tier system this phase deletes with an `AWAITING_PAYMENT`
 * → OPEN tier entry and a `resolveLockTier({status, quoteState})` fold-in.
 * Neither survives the merge as a tier concept — but the underlying intent
 * ("a job whose pricing has gone to the client shouldn't silently reprice")
 * is preserved by `pricingLocked` itself: `sendNative` raises it the moment a
 * LIVE-version quote is sent (D55), long before AWAITING_PAYMENT is reached,
 * so the two systems agree on the common path. `convex/lib/projectAutoStatus.ts`
 * additionally raises it defensively on the two paths that reach
 * AWAITING_PAYMENT/CONFIRMED WITHOUT a live-version send ever having happened
 * (an invoice-first job with no quote at all, and accepting a NON-live
 * quote's version via make-live) — see that module's own note. `isConfirmedOrLater`/
 * `crossesIntoSnapshotStatus` below are kept from the OLD system verbatim
 * (pipeline-position helpers, never part of the tier/lock rewrite).
 *
 * See FEATUREDOCS/78's Phase 4 section and
 * `convex/lib/projectLocks.test.ts` for the truth table + D54-D57 edge cases.
 */

// ─── Locked field lists (the authoritative export — UNCHANGED by Phase 4) ───

/** Project-level fields gated when the LIVE version is pricing-locked (recalc
 *  INPUTS — the recalc OUTPUTS in PROJECT_MONEY_ANCHORS (projectWrites.ts) are
 *  already unconditionally stripped and never reach here). */
export const LOCKED_PROJECT_FIELDS = [
  "taxRate",
  "discountPercent",
] as const;

// `discountMode` (#1012) travels with `discount` in both lists: it is the entry
// shape of that exact number, so a restore/revert that restores the dollar
// amount must restore how it was entered too — otherwise a reverted line
// keeps printing "%" for a `$` discount (or vice versa).
export const LOCKED_GROUP_FIELDS = ["price", "discount", "discountMode", "rentalPeriod", "rentalQuantity"] as const;

export const LOCKED_LINE_ITEM_FIELDS = ["unitPrice", "discount", "discountMode", "duration", "taxRate"] as const;

/** `costTotal` is locked only for CREW-LESS services — a crew-attached service's
 *  costTotal keeps auto-deriving from the crew rate table even while locked
 *  (assigning crew at known rates is a deliberate act; see recalcServiceCostFromCrew).
 *  Callers must check `hasCrew` themselves before applying this list. */
export const LOCKED_SERVICE_FIELDS = ["costTotal", "billableToClient"] as const;

export const LOCKED_CREW_FIELDS = ["rateOverride", "rateType", "estimatedHours"] as const;

// ─── Live-version resolution ─────────────────────────────────────────────────

/**
 * Whether `versionId` (a row's own `versionId` field, for one of the four
 * versioned plan tables) is the project's LIVE version — the only thing
 * `pricingLocked` ever applies to. A row with no `versionId` (pre-Phase-1
 * legacy, or a table Phase 2 never versioned — crew assignments, the
 * `projects` row itself) reads as live: there is no non-live copy of it to be
 * exempt on behalf of. Likewise a project with no `liveVersionId` yet
 * (un-backfilled) reads every row as live — the safe, conservative default
 * (never silently widen what counts as "exempt from the lock").
 */
export function isLiveVersionRow(
  project: Pick<Doc<"projects">, "liveVersionId">,
  versionId: string | null | undefined,
): boolean {
  if (!versionId) return true;
  if (!project.liveVersionId) return true;
  return versionId === project.liveVersionId;
}

/**
 * Whether a NEW row about to be inserted should default its price/cost
 * fields to $0 instead of the normal auto-price/rate autofill.
 *
 * #1221 follow-up (closes Phase 5's Equipment write-side gap): a CREATE
 * mutation can now target an explicit non-live `targetVersionId`
 * (`resolveWriteVersionId`), not just the live version by construction —
 * `pricingLocked` applies to the LIVE version's money fields ONLY (file
 * header), so an insert aimed at a non-live version must NEVER default to
 * $0 just because the project's live pricing happens to be locked. Omitting
 * `targetVersionId` (every pre-existing call site) preserves the old
 * behaviour exactly: `isLiveVersionRow(project, undefined)` reads as live,
 * same as before this param existed.
 */
export function defaultsToZeroOnInsert(
  project: Pick<Doc<"projects">, "pricingLocked" | "liveVersionId">,
  targetVersionId?: string | null,
): boolean {
  return project.pricingLocked === true && isLiveVersionRow(project, targetVersionId);
}

/** The `pricedUnderLock` field value for a fresh group/line-item insert —
 *  `true` when `defaultToZero` forced this row's price to $0/unset, `undefined`
 *  (absent, Convex's "false") otherwise. ONE helper so every insert site
 *  derives the same value instead of re-deriving `defaultToZero || undefined`
 *  inline at each call site (R-3.1). */
export function pricedUnderLockOnInsert(defaultToZero: boolean | undefined): true | undefined {
  return defaultToZero || undefined;
}

/** Activity-log metadata for a write that touched money while the project's
 *  live pricing was locked (only ever true for the $0-defaulted new-add case —
 *  a direct edit to an already-locked money field is rejected outright by
 *  `assertPricingUnlocked`, never allowed through). `logActivity` already
 *  records who/what/when/before-after on every write, so there is no
 *  freeform-text counterpart to the deleted per-edit justification — just this
 *  one stable marker. */
export function afterLockAuditMetadata(wasLocked: boolean): Record<string, unknown> | undefined {
  return wasLocked ? { afterLock: true } : undefined;
}

/**
 * The four-field patch that RAISES `pricingLocked` — one shape shared by
 * every site that sets it (D55's `sendNative`, `updateStatusNative`'s
 * CONFIRMED transition, `lockPricingNative`, and `projectAutoStatus.ts`'s
 * defensive raise), so the fields can't drift apart between call sites
 * (R-3.1). Callers `ctx.db.patch(project._id, { ...pricingLockRaiseFields(actor, now), ... })`,
 * adding their own `updatedAt`/other fields to the same patch. Never clears
 * the lock — that's each caller's own explicit, narrower-audience patch
 * (D42/D56), not something this shared shape should make easy to get wrong.
 */
export function pricingLockRaiseFields(
  actor: { userId: string; userName: string },
  now: number,
): { pricingLocked: true; pricingLockedAt: number; pricingLockedById: string; pricingLockedByName: string } {
  return {
    pricingLocked: true,
    pricingLockedAt: now,
    pricingLockedById: actor.userId,
    pricingLockedByName: actor.userName,
  };
}

// ─── The money guard (#1230's `assertPricingUnlocked`) ──────────────────────

/**
 * Reject a MONEY write against the project's LIVE version while
 * `pricingLocked` is set. Synchronous and side-effect-free (no session lookup,
 * no justification, no tier resolution) — the entire point of collapsing 4
 * tiers to 1 boolean. Structural and plan-field writes never call this at all
 * (no gate — see the file header).
 *
 * `versionId` is the row's own `versionId` (for one of the four versioned
 * plan tables) — omit it for a table/row that has no version concept
 * (`projects` itself, `crewAssignments`), which always reads as live.
 */
export function assertPricingUnlocked(
  project: Pick<Doc<"projects">, "pricingLocked" | "liveVersionId">,
  versionId?: string | null,
): void {
  if (project.pricingLocked !== true) return;
  if (!isLiveVersionRow(project, versionId)) return; // non-live version — the lock never applies
  throw new ConvexError({
    code: "PRICING_LOCKED",
    message: "This project's pricing is locked. Clear the lock (project header) to edit money fields.",
  });
}

// ─── Who can clear the lock (D42) ────────────────────────────────────────────

/**
 * `canUnlockPricing = hasPermission(role, "invoice", "publish") ||
 * isProjectManagerOf(projectId, userId)` (design §4.5 D42) — owner/admin/
 * manager, OR this job's own PM. `member` holds `project:update` but NOT
 * `invoice:publish` (`permissionsCore.ts`), so a member can price a project
 * freely while it's open and cannot re-open one whose quote has gone out.
 *
 * This is the RENAMED successor to the old `isHardLockOverrideAllowed` (same
 * two-part audience shape — a role test OR the project's own PM — single
 * source of truth, POLICY.md R-3.1) with its role test swapped from a bare
 * `role === "owner" || role === "admin"` check to the `invoice:publish`
 * permission check D42 specifies, which also admits `manager`.
 */
export async function canUnlockPricing(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  if (member && hasPermission(member.role, "invoice", "publish")) return true;

  const pm = await ctx.db
    .query("projectManagers")
    .withIndex("by_projectId_userId", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first();
  return pm != null && pm.organizationId === orgId;
}

export async function requireCanUnlockPricing(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const allowed = await canUnlockPricing(ctx, orgId, projectId, userId);
  if (!allowed) {
    throw new ConvexError({
      code: "FORBIDDEN_UNLOCK_PRICING",
      message: "Only org admins/owners/managers or this project's assigned PM(s) can clear the pricing lock.",
    });
  }
}

// ─── Unrelated-to-locking helpers that used to live in this file ────────────

/** Pipeline-position helper — unrelated to pricing locking (used by
 *  availability/overbooking logic to mean "is this booking firm"). Kept here
 *  (rather than moved) only because it predates this file's Phase 4 rewrite
 *  and has callers across `convex/lib/availabilityCore.ts`,
 *  `convex/lib/overbookingBoard.ts`, `convex/lib/crewConflicts.ts` and
 *  `src/lib/overbooking-core.ts` that never depended on `LockTier` — its
 *  behaviour is UNCHANGED by this phase's deletion of the 4-tier system. */
const CONFIRMED_OR_LATER_STATUSES = new Set([
  "CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED", "INVOICED",
]);
export function isConfirmedOrLater(status: string | null | undefined): boolean {
  return !!status && CONFIRMED_OR_LATER_STATUSES.has(status);
}

/** True for any status transition that lands exactly on CONFIRMED or
 *  COMPLETED — forward advance OR a revert-then-re-advance ("re-crossing").
 *  Unrelated to pricing locking (a whole-project version SNAPSHOT — #792 —
 *  is taken on every crossing; that mechanism is untouched by this phase). */
export function crossesIntoSnapshotStatus(from: string | null | undefined, to: string): boolean {
  return from !== to && (to === "CONFIRMED" || to === "COMPLETED");
}
