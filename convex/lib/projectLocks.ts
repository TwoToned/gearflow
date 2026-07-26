import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertStrLen } from "./fieldGuards";

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

export function isConfirmedOrLater(status: string | null | undefined): boolean {
  return lockTierForStatus(status) !== "OPEN";
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
 *  stripped and never reach here). */
export const LOCKED_PROJECT_FIELDS = [
  "taxRate",
  "discountPercent",
  "depositPercent",
  "depositPaid",
  "invoicedTotal",
] as const;

export const LOCKED_GROUP_FIELDS = ["price", "discount", "rentalPeriod", "rentalQuantity"] as const;

export const LOCKED_LINE_ITEM_FIELDS = ["unitPrice", "discount", "duration"] as const;

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
}

export interface LifecycleGuardResult {
  tier: LockTier;
  openSession: Doc<"projectUnlockSessions"> | null;
  /** True when a $0 default should be applied to a NEW add (see shouldDefaultToZero). */
  defaultToZero: boolean;
}

const JUSTIFICATION_BOUNDS = { min: 10, max: 1000 } as const;

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
 * Throws `ConvexError` with a stable `code` the client can branch on:
 * `PROJECT_LOCKED` | `FINANCIALS_LOCKED` | `JUSTIFICATION_REQUIRED`.
 */
export async function assertLifecycleGuard(
  ctx: MutationCtx,
  project: Pick<Doc<"projects">, "id" | "organizationId" | "status">,
  opts: LifecycleGuardOptions,
): Promise<LifecycleGuardResult> {
  const tier = lockTierForStatus(project.status);
  if (tier === "OPEN") return { tier, openSession: null, defaultToZero: false };

  const openSession = await getOpenUnlockSession(ctx, project.organizationId, project.id);
  const defaultToZero = shouldDefaultToZero(tier, openSession);

  if (tier === "HARD_LOCKED") {
    if (openSession?.scope === "FULL") return { tier, openSession, defaultToZero };
    throw new ConvexError({
      code: "PROJECT_LOCKED",
      message: "This project is completed and hard-locked. Open a full unlock session to make changes.",
    });
  }

  if (opts.kind === "financial") {
    if (openSession) return { tier, openSession, defaultToZero };
    throw new ConvexError({
      code: "FINANCIALS_LOCKED",
      message: "This project's financials are locked. Open an unlock session (Financials tab) to edit money fields.",
    });
  }

  // structural
  if (tier === "FINANCE_LOCKED") {
    // #793's structural gate doesn't start until ON_SITE — CONFIRMED/PREPPING/
    // CHECKED_OUT only gate financial fields (handled above).
    return { tier, openSession, defaultToZero };
  }

  // tier === "JUSTIFY"
  if (openSession) return { tier, openSession, defaultToZero }; // no double-prompt
  const justification = opts.justification?.trim();
  if (!justification || justification.length < JUSTIFICATION_BOUNDS.min) {
    throw new ConvexError({
      code: "JUSTIFICATION_REQUIRED",
      message: `This project is ${project.status} — describe why this change is needed (at least ${JUSTIFICATION_BOUNDS.min} characters).`,
    });
  }
  assertStrLen(justification, "justification", JUSTIFICATION_BOUNDS);
  return { tier, openSession, defaultToZero };
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
  ctx: MutationCtx,
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
