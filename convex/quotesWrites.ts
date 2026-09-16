import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNumRange, assertStrLen } from "./lib/fieldGuards";
import { assertClientContactBelongsToClient, assertRefInOrg } from "./lib/orgRef";
import { requireCanUnlockPricing, pricingLockRaiseFields } from "./lib/projectLocks";
import { captureProjectSnapshot } from "./lib/projectSnapshots";
import { buildFinanceLines } from "./lib/financeSnapshot";
import { resolveOrgQuoteConfig, resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { maybeAutoAdvanceProjectStatus } from "./lib/projectAutoStatus";
import { computeValidUntil, startOfDayInTimezone, QUOTE_VALIDITY_BOUNDS } from "./lib/quoteDates";
import { loadTotalsBundle, computeTotals } from "./lib/recalc";
import { resolveWriteVersionId, requireLiveVersionId } from "./lib/versionScope";
import { performMakeLive } from "./lib/makeLiveCore";
import {
  effectiveQuoteStatus,
  findQuoteAtRevision,
  findQuoteForVersion,
  isLiveQuoteStatus,
  listProjectQuotes,
  projectLiveRevision,
  projectRevision,
  quoteLabel,
  quoteTargetsLiveVersion,
  requireProjectInOrg,
  requireQuoteInOrg,
  requireQuoteOwnerOnly,
  type EffectiveQuoteStatus,
} from "./lib/quoteState";
import { LABEL_BOUNDS } from "./projectVersionsWrites";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Quote revision mutations (#986 — Phase A of the finance version-control
 * program). Send / recall / new-version / accept / decline / recall-then-delete
 * over ONE shared counter, `projects.revision`:
 *
 * ```
 *   v1 DRAFT ─ send ─▶ v1 SENT ─ accept ─▶ v1 ACCEPTED ─▶ project may CONFIRM
 *        ▲               │ │
 *        └─ recall ──────┘ └─ decline ─▶ v1 DECLINED
 *   (send also raises projects.pricingLocked — D55 — new version ─▶ v2 DRAFT,
 *    v1 → SUPERSEDED on v2's send)
 * ```
 *
 * **#1229 Phase 3 note.** This file used to also carry `deleteDraftNative`
 * (#1028, undid a fat-fingered "new version") and `deleteVersionNative`
 * (#1097, deleted a saved-but-never-sent version) plus `setQuoteProtectedNative`
 * (#1030) and `repriceFromRevisionNative` (#989) — all DELETED in Phase 3 of
 * "Project versioning v2" (parent #1221), superseded by the real
 * `projectVersions`-table verb set in `convex/versions.ts`
 * (`createNative`/`makeLiveNative`/`setLabelNative`/`deleteNative`). See
 * FEATUREDOCS/78's Phase 3 section.
 *
 * **#1230 Phase 4 note.** `unacceptNative` and `correctQuoteNative`, and every
 * check against `quotes.protected` (in `recallNative`/`deleteRecalledNative`/
 * the since-deleted `correctQuoteNative`), are DELETED — the whole protect/
 * unprotect mechanism is gone along with the 4-tier lock system it propped up.
 * `markAcceptedNative` no longer sets `protected` either. `sendNative` now
 * SETS `projects.pricingLocked` (D55) and `recallNative` now CLEARS it (D56,
 * only for the live version's quote) — see `convex/lib/projectLocks.ts` and
 * FEATUREDOCS/78's Phase 4 section.
 *
 * **#1233 Phase 6 note ("quotes from any version" — the payoff of the whole
 * program).** `sendNative` now takes an optional `versionId` (a REAL
 * `projectVersions` row id, Phase 1-3's table, not a revision number) and can
 * target ANY version, live or not. Two versions of one project can hold
 * `SENT` quotes SIMULTANEOUSLY — "quote two options" — because cross-version
 * supersede is gone (D19); only a same-live-version newer revision (the OLDER
 * `newVersionNative` draft-cutting lineage, unchanged) still supersedes.
 * Accepting a NON-live version's quote now COMPOSES `versions.makeLiveNative`
 * (via the shared `performMakeLive`, `convex/lib/makeLiveCore.ts`) — accept
 * IS make-live, per D20 — and supersedes every other open quote ACROSS EVERY
 * version, enforcing "at most one ACCEPTED per project". `pricingLocked`
 * (D55/D56) keys off `quoteTargetsLiveVersion`, not the revision number, so
 * quoting a speculative non-live option never freezes/unfreezes the live
 * job's pricing. See `convex/versions.ts`'s ASCII state-machine diagram for
 * the full picture — this file's own diagram above is the OLDER, still-valid
 * revision-number-only view; the two compose via `quotes.versionId`.
 *
 * Properties this file still guarantees, each with a test in
 * `quotesWrites.test.ts`:
 *
 * - **At most one quote row per `(projectId, versionId)`** (Phase 6,
 *   `by_projectId_versionId`) — the version-scoped uniqueness guard. The
 *   OLDER **`(projectId, revision)`** guard (`by_projectId_version`) still
 *   holds too, for the live version's own revision-number lineage.
 * - **At most one live (`SENT`/`ACCEPTED`) row PER VERSION** — cross-version,
 *   MULTIPLE live rows are now the whole point (D19).
 * - **At most one `ACCEPTED` row per PROJECT, ever** (D20, Phase 6) — accepting
 *   one supersedes every other open quote, across every version.
 * - **`projects.revision` is monotonic for any revision that was ever SENT** —
 *   never decremented, never reused. A recalled-then-re-sent revision keeps
 *   its number. Phase 6 also allocates from it for a non-live version's FIRST
 *   send (there is no `newVersionNative`-style draft-opening step for a
 *   non-live target) — see `prepareSend`.
 * - **Supersede fires on SEND, not on draft, and only WITHIN the same target
 *   version.** v1 stays `SENT` while v2 is a draft FOR THE SAME (live)
 *   version, so cutting a draft never invalidates the client's document —
 *   that's the difference between version control and a delete button.
 *   Sending version B never supersedes version A's quote (D19). (Recall no
 *   longer un-supersedes a displaced revision on the way back either —
 *   #1229 Phase 3 removed that branch; see `recallNative`'s own comment.)
 *
 * Every mutation takes the standard 4-guard browser-direct shape
 * (FEATUREDOCS/54): `assertWritesEnabled`, `enforceBrowserWriteLimit`,
 * `requireOrgPermission`, `resolveActor` — plus org-checked reference loads
 * (`by_cuid`/`by_projectId` are GLOBAL indexes, R-8.4.3) and `writeActivityLog`.
 *
 * **Money never originates from the client** (R-9.3). `sendNative`'s only client
 * inputs are `quoteDate`, `validityDays`, `recipientContactId` and `notes`; every
 * figure comes from `buildFinanceLines` plus the project's own recalc-owned
 * totals, exactly as the superseded `publishNative` did.
 *
 * **Permissions (decision 11).** Send / new-version / accept / decline check
 * `invoice:publish` (owner/admin/manager). **Recall additionally requires
 * `canUnlockPricing`** (D42 — `invoice:publish` OR one of the project's
 * `projectManagers`) — un-sending a document the client may already be holding is
 * trust-sensitive in a way the other verbs are not. No new permission resource
 * is introduced.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Mirrors `quoteSchema`'s bounds in `src/lib/validations/quote.ts` — the client
 *  Zod parse is UX only and is bypassable by any caller with a valid session
 *  hitting the mutation directly (FEATUREDOCS/54 "the write security bar"). */
const NOTES_BOUNDS = { max: 2000 } as const;
/** Recall reuses #793's justification bounds rather than inventing a third copy. */
const RECALL_REASON_BOUNDS = { min: 10, max: 1000 } as const;
const DECLINE_REASON_BOUNDS = { min: 3, max: 1000 } as const;
const ACCEPTANCE_REF_BOUNDS = { max: 200 } as const;
/** Any date a client may stamp on a revision. Bounded so a typo'd year can't mint
 *  a `validUntil` centuries out (or a negative instant). */
const DATE_BOUNDS = { min: 0, max: 4_102_444_800_000 } as const; // ≤ 2100-01-01

/** Project statuses a successful send offers to advance to `QUOTED` from. The
 *  UI decides whether to take the offer — status is never forced by a quote verb
 *  (same precedent as "issuing an invoice offers to advance to INVOICED"). */
const SEND_OFFERS_QUOTED_FROM = new Set(["ENQUIRY", "QUOTING"]);
/** Accepting offers to advance to CONFIRMED from any pre-confirmed status. */
const ACCEPT_OFFERS_CONFIRMED_FROM = new Set(["ENQUIRY", "QUOTING", "QUOTED"]);

const offerValidator = v.union(
  v.literal("QUOTED"),
  v.literal("CONFIRMED"),
  v.literal("CANCELLED"),
  v.null(),
);

/** The 4-guard preamble every verb shares. `invoice:publish` is the audience for
 *  all five; recall layers `requireCanUnlockPricing` on top. */
async function guardQuoteWrite(
  ctx: MutationCtx,
  orgId: string,
  suppliedActor: { userId: string; userName: string },
): Promise<{ userId: string; userName: string }> {
  await assertWritesEnabled(ctx, "quote");
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, "invoice", "publish");
  return await resolveActor(ctx, suppliedActor);
}

/** Load the quote + its project together, both org-checked, for the four verbs
 *  that address a quote by id. */
async function loadQuoteAndProject(
  ctx: MutationCtx,
  quoteId: string,
  orgId: string,
): Promise<{ quote: Doc<"quotes">; project: Doc<"projects"> }> {
  const quote = await requireQuoteInOrg(ctx, quoteId, orgId);
  const project = await requireProjectInOrg(ctx, quote.projectId, orgId);
  return { quote, project };
}

/** Assert a quote is in one of the states a verb accepts, with a message that
 *  names the actual state and the way out rather than a bare "invalid". */
function assertQuoteStatusIs(
  actual: EffectiveQuoteStatus,
  allowed: readonly EffectiveQuoteStatus[],
  label: string,
  verb: string,
): void {
  if (allowed.includes(actual)) return;
  const hint =
    actual === "EXPIRED"
      ? ` It expired — send it again to ${verb} it.`
      : actual === "DRAFT"
        ? " It hasn't been sent yet."
        : actual === "SUPERSEDED"
          ? " A newer revision has since been sent."
          : "";
  throw new ConvexError({
    code: "QUOTE_STATE_INVALID",
    message: `Can't ${verb} ${label} — it is ${actual.toLowerCase()}.${hint}`,
  });
}

/**
 * The money snapshot frozen onto a revision at send. Built entirely
 * server-side from `buildFinanceLines` + a freshly-computed totals bundle
 * (R-9.3) — **never** the LIVE `project.subtotal`/`total`/etc fields
 * directly, because those describe the LIVE version only (`recalc.ts`'s
 * file-header comment) and this snapshot may be for a NON-live `versionId`
 * (#1233, Phase 6).
 *
 * For the LIVE version this is byte-identical to reading `project.*`
 * directly — `loadTotalsBundle`/`computeTotals` are PROVEN (the differential
 * test, `convex/recalcSplit.differential.test.ts`) to compute exactly what
 * `recalcProjectTotals` already persisted — so this is a value-neutral
 * hardening for the live case (the snapshot no longer depends on nothing
 * having changed `projects.*` between the last recalc and this send) and the
 * CORRECTNESS fix for the non-live case (that version's own discount/tax,
 * via `resolveEffectiveProjectForVersion`, not the live version's).
 */
async function buildQuoteSnapshot(
  ctx: MutationCtx,
  project: Doc<"projects">,
  notes: string | undefined,
  versionId: string,
): Promise<Record<string, unknown>> {
  const orgId = project.organizationId;
  const lines = await buildFinanceLines(ctx, project.id, orgId, versionId);
  const orgDefaultTaxRate = await resolveOrgDefaultTaxRate(ctx, orgId);
  const bundle = await loadTotalsBundle(ctx, project.id, orgId, orgDefaultTaxRate, versionId);
  // `bundle` is only null when the project itself has vanished mid-transaction
  // — unreachable in practice (prepareSend already loaded the same project a
  // moment earlier, inside the same mutation), but this is the freeze moment
  // for a client-facing document, so fail toward an all-zero snapshot rather
  // than letting `computeTotals` see a null bundle.
  if (!bundle) {
    return { lines, subtotal: 0, discountPercent: 0, discountAmount: 0, taxRate: null, taxAmount: 0, total: 0, notes: notes ?? null };
  }
  const totals = computeTotals(bundle);
  return {
    lines,
    subtotal: totals.subtotal,
    discountPercent: Number(bundle.project.discountPercent) || 0,
    discountAmount: totals.discountAmount,
    taxRate: bundle.project.taxRate != null ? Number(bundle.project.taxRate) : null,
    taxAmount: totals.taxAmount,
    total: totals.total,
    notes: notes ?? null,
  };
}

/**
 * Everything `sendNative` must establish before it starts writing: the project is
 * real, in-org, not a template, not hard-locked; the target version is real and
 * ready; the recipient (if any) belongs to this project's client; the target
 * has an editable draft (or none yet); and the client-minted id isn't a
 * duplicate. Split out of the handler so the write path reads as a straight
 * line (R-3.6).
 *
 * #1233 (Phase 6) — the addressing key is now the TARGET VERSION
 * (`targetVersionId`, resolved/validated via `resolveWriteVersionId`, default
 * live), not a bare revision number. Two branches:
 *
 * - **Live target** — byte-identical to the pre-Phase-6 behaviour: the row a
 *   send freezes is whichever revision is `projectLiveRevision(project)` (see
 *   the #1080/#1097 note kept below), found via `findQuoteAtRevision`. A row
 *   sent before this phase has no `versionId` yet — it is still found here
 *   and gets one stamped by `sendNative` on this very send.
 * - **Non-live target** — addressed by `findQuoteForVersion` instead (no
 *   revision-number lineage exists for a version that was never live). A
 *   first-ever send for this version allocates a FRESH number off the SAME
 *   `projects.revision` allocator `newVersionNative` uses ("the highest
 *   version number ever handed out") — see `sendNative`'s own bump.
 */
/** The recipient must belong to THIS project's client — otherwise a caller
 *  could stamp another client's contact onto the revision and leak their PII
 *  onto the document (the same check the project's own contact picker
 *  makes). Split out of `prepareSend` purely to keep its own complexity
 *  manageable (R-3.6). */
async function assertRecipientBelongsToProjectClient(
  ctx: MutationCtx,
  args: { recipientContactId: string | undefined; project: Doc<"projects">; organizationId: string },
): Promise<void> {
  const { recipientContactId, project, organizationId } = args;
  if (!recipientContactId) return;
  if (!project.clientId) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "Assign a client before choosing a recipient." });
  }
  await assertClientContactBelongsToClient(ctx, recipientContactId, project.clientId, organizationId);
}

/**
 * The revision number + existing row `sendNative` should target, split by
 * branch (R-3.6, keeps `prepareSend` itself a straight line):
 *
 * - **Live target** — byte-identical to pre-Phase-6 behaviour (#1080/#1097
 *   note below).
 * - **Non-live target** — addressed by `findQuoteForVersion` instead (no
 *   revision-number lineage exists for a version that was never live); a
 *   first-ever send allocates a fresh number off the shared allocator.
 */
async function resolveSendTarget(
  ctx: MutationCtx,
  args: { organizationId: string; projectId: string; project: Doc<"projects">; targetVersionId: string; isLive: boolean },
): Promise<{ revision: number; existing: Doc<"quotes"> | null }> {
  const { organizationId, projectId, project, targetVersionId, isLive } = args;
  if (isLive) {
    // #1080/#1097 — the row a send freezes is whichever revision is LIVE, not
    // necessarily the allocator's high-water mark: the OLDER `promoteRevisionNative`
    // (deleted in #1229 Phase 3) could point `liveRevision` at an older number
    // while `revision` stayed ahead of it, and a project promoted under that
    // now-gone mutation may still carry a decoupled pair. `newVersionNative`
    // already keys off `liveRevision` for the same reason — this keeps
    // `sendNative` in line so such a row still sends the right revision rather
    // than silently targeting the wrong one.
    const revision = projectLiveRevision(project);
    const existing = await findQuoteAtRevision(ctx, organizationId, projectId, revision);
    return { revision, existing };
  }
  const existing = await findQuoteForVersion(ctx, organizationId, projectId, targetVersionId);
  return { revision: existing ? existing.version : projectRevision(project) + 1, existing };
}

/** Throws unless `existing` (if any) is a reusable DRAFT, or (if none) `id`
 *  isn't already a duplicate row. Split out of `prepareSend` (R-3.6). */
async function assertSendTargetIsWritable(
  ctx: MutationCtx,
  args: { id: string; label: string; existing: Doc<"quotes"> | null; isLive: boolean; revision: number; now: number },
): Promise<void> {
  const { id, label, existing, isLive, revision, now } = args;
  if (!existing) {
    // `by_cuid` is global and non-unique — dup-guard the client-minted id.
    const dup = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError({ code: "DUPLICATE", message: "Quote already exists" });
    return;
  }
  if (effectiveQuoteStatus(existing, now) === "DRAFT") return;
  throw new ConvexError({
    code: "QUOTE_ALREADY_SENT",
    message: isLive
      ? `${label} has already been sent. Create v${revision + 1} to change it.`
      : `${label} has already been sent. Recall it first to make changes.`,
  });
}

async function prepareSend(
  ctx: MutationCtx,
  args: { organizationId: string; projectId: string; id: string; recipientContactId?: string; versionId?: string; now: number },
): Promise<{
  project: Doc<"projects">;
  revision: number;
  label: string;
  existing: Doc<"quotes"> | null;
  quoteId: string;
  targetVersionId: string;
  isLive: boolean;
}> {
  const { organizationId, projectId, id, recipientContactId, versionId, now } = args;

  await assertRefInOrg(ctx, "projects", projectId, organizationId);
  const project = await requireProjectInOrg(ctx, projectId, organizationId);
  if (project.isTemplate) {
    throw new ConvexError({ code: "TEMPLATE_QUOTE", message: "Templates don't have quotes." });
  }
  // #1230: sending a quote is never gated by `pricingLocked` — it freezes the
  // CURRENT figures into a snapshot, it doesn't set any LOCKED_*_FIELDS itself.
  // Locking blocks direct money-field edits (unitPrice/discount/taxRate/...),
  // not the act of sending what's already there. (This is also the mutation
  // that RAISES the lock — see sendNative's own D55 note below.)

  // #1233 — validated against `project` (same org/project, contentState
  // "ready") the same way every other CREATE call site on the versioned plan
  // tables validates a caller-supplied `versionId` — a send landing on a
  // foreign project's version would be a persisted, IDOR-shaped bug.
  const targetVersionId = await resolveWriteVersionId(ctx, project, versionId);
  const isLive = targetVersionId === requireLiveVersionId(project);

  await assertRecipientBelongsToProjectClient(ctx, { recipientContactId, project, organizationId });

  const { revision, existing } = await resolveSendTarget(ctx, { organizationId, projectId, project, targetVersionId, isLive });
  const label = quoteLabel(project.projectNumber, revision);
  await assertSendTargetIsWritable(ctx, { id, label, existing, isLive, revision, now });

  return { project, revision, label, existing, quoteId: existing?.id ?? id, targetVersionId, isLive };
}

/** D55 (#1230, generalised #1233) — raises `projects.pricingLocked` only
 *  when the version being sent IS the live one, idempotently (D57 — a resend
 *  of an already-locked project leaves `pricingLockedAt`/`pricingLockedById`
 *  untouched). Split out of `sendNative`'s handler (R-3.6). */
async function raisePricingLockIfLiveSend(
  ctx: MutationCtx,
  args: { project: Doc<"projects">; isLive: boolean; actor: { userId: string; userName: string }; now: number },
): Promise<void> {
  const { project, isLive, actor, now } = args;
  if (!isLive || project.pricingLocked === true) return;
  await ctx.db.patch(project._id, pricingLockRaiseFields(actor, now));
}

/** The exact shape `sendNative`'s handler builds as `sendFields` — named so
 *  both the patch and the insert below stay schema-checked against
 *  `Doc<"quotes">` after this was split out of the handler (R-3.6), the same
 *  way it was (implicitly, via inference) before the split. */
interface QuoteSendFields {
  status: "SENT";
  snapshot: Record<string, unknown>;
  snapshotId: string;
  versionId: string;
  quoteDate: number;
  validUntil: number;
  validityDays: number;
  recipientContactId: string | undefined;
  notes: string | undefined;
  sentAt: number;
  sentById: string;
  recalledAt: undefined;
  recalledById: undefined;
  recallReason: undefined;
  labelOnDocument: boolean | undefined;
  updatedAt: number;
}

/**
 * Writes the SENT quote row — patches `existing` if this send reuses one
 * (recall→resend, or the live lineage's already-open draft), otherwise
 * inserts a fresh row, pinning `liveRevision`/bumping `projects.revision`
 * for a non-live target's first-ever send (see `sendNative`'s own comment
 * for why the pin matters). Split out of `sendNative`'s handler (R-3.6).
 */
async function persistSentQuoteRow(
  ctx: MutationCtx,
  args: {
    project: Doc<"projects">;
    existing: Doc<"quotes"> | null;
    quoteId: string;
    organizationId: string;
    projectId: string;
    revision: number;
    isLive: boolean;
    actor: { userId: string; userName: string };
    now: number;
    sendFields: QuoteSendFields;
  },
): Promise<void> {
  const { project, existing, quoteId, organizationId, projectId, revision, isLive, actor, now, sendFields } = args;
  if (existing) {
    await ctx.db.patch(existing._id, sendFields);
    return;
  }
  // #1233 — a brand-new row for a NON-live target's first-ever send
  // consumes a fresh number off the SAME allocator `newVersionNative` uses
  // ("the highest version number ever handed out") — bump it so a later
  // live-lineage `newVersionNative` call never collides with it. The
  // live-target branch never reaches here with a number ahead of
  // `projects.revision` (see `prepareSend`), so this is a no-op then.
  //
  // Pin `liveRevision` EXPLICITLY at its current resolved value before
  // bumping `revision` out from under it: `projectLiveRevision` falls back
  // to `revision` whenever `liveRevision` is absent, so bumping the shared
  // allocator for a NON-live send would otherwise silently shift what the
  // LIVE branch resolves "the live revision" to on ITS OWN next first-ever
  // send — a real collision (proven by `quotesWrites.test.ts`'s "D55:
  // sending the LIVE version locks pricing; sending a NON-live version does
  // not").
  if (!isLive && revision > projectRevision(project)) {
    await ctx.db.patch(project._id, { revision, liveRevision: projectLiveRevision(project), updatedAt: now });
  }
  await ctx.db.insert("quotes", {
    id: quoteId,
    organizationId,
    projectId,
    version: revision,
    createdById: actor.userId,
    createdAt: now,
    ...sendFields,
  });
}

/**
 * Supersede-on-SEND (never on draft): whatever the client was holding for
 * THIS TARGET VERSION stops being the current document the moment a newer
 * revision of it goes out. #1233 (D19) — scoped to `targetVersionId`: sending
 * version B never supersedes version A's quote (cross-version supersede is
 * gone), but a same-live-version newer revision (the OLDER `newVersionNative`
 * draft-cutting lineage) still supersedes exactly as before.
 *
 * A pre-Phase-6 row with no `versionId` stamped only ever counts as "same
 * version as `targetVersionId`" when the target IS live AND the old row's
 * OWN revision-number check (`quoteTargetsLiveVersion`) says it currently
 * targets live too — NOT a blind "no versionId means live", which would
 * wrongly supersede an older, already-past revision the live lineage has
 * since moved beyond (the same care `recallNative`'s D56 check takes).
 */
async function supersedeLiveQuotes(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  keepQuoteId: string,
  targetVersionId: string,
  project: Doc<"projects">,
  now: number,
): Promise<void> {
  const targetIsLive = targetVersionId === requireLiveVersionId(project);
  for (const other of await listProjectQuotes(ctx, orgId, projectId)) {
    if (other.id === keepQuoteId) continue;
    if (!isLiveQuoteStatus(effectiveQuoteStatus(other, now))) continue;
    const otherTargetsSameVersion =
      other.versionId != null ? other.versionId === targetVersionId : targetIsLive && quoteTargetsLiveVersion(other, project);
    if (!otherTargetsSameVersion) continue;
    await ctx.db.patch(other._id, { status: "SUPERSEDED", supersededByQuoteId: keepQuoteId, updatedAt: now });
  }
}

/**
 * SEND — the freeze moment. Stamps the user-chosen `quoteDate`, the computed
 * `validUntil`, the recipient and the money snapshot onto the current revision,
 * captures a `QUOTE_SENT` project snapshot for the same revision, and supersedes
 * whatever the client was previously holding.
 *
 * "Send" does NOT email anybody (decision 7) — Flow records the send, freezes
 * pricing and (Phase B, #987) produces the PDF for the user to attach to their
 * own mail. The dialog says so outright.
 *
 * The DRAFT row is created here when the revision has none yet, so a project that
 * has never quoted doesn't need a separate "create draft" round trip. `id` is the
 * client-minted cuid for that row and is ignored when a draft already exists.
 */
export const sendNative = mutation({
  returns: v.object({
    id: v.string(),
    version: v.number(),
    validUntil: v.number(),
    /** Non-null when #1160's automation ALREADY moved the job (UI confirms, never asks). */
    autoStatusChange: v.union(v.literal("QUOTED"), v.null()),
    offerStatusChange: offerValidator,
  }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    /** User-chosen date printed on the PDF and the anchor for validity. */
    quoteDate: v.number(),
    /** Defaults to the org's `documents.quoteValidityDays` when omitted. */
    validityDays: v.optional(v.number()),
    recipientContactId: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** #1080/#1097 — "Print this label on the document" checkbox. Off by
     *  default: an unexplained label on a client document invites the obvious
     *  question about what the other options were. Ignored (never stamped)
     *  when the revision has no `label` set — there is nothing to print. */
    labelOnDocument: v.optional(v.boolean()),
    /** #1233 (Phase 6) — the REAL `projectVersions` row to quote from.
     *  Additive-only: omitted ⇒ the project's live version, byte-identical
     *  to every pre-Phase-6 call site. Validated against `project` (same
     *  org/project, `contentState: "ready"`) inside `prepareSend`. */
    versionId: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, organizationId, projectId, quoteDate, validityDays, recipientContactId, notes, labelOnDocument, versionId, auditId, now } = args;
    const actor = await guardQuoteWrite(ctx, organizationId, args.actor);

    assertStrLen(notes, "notes", NOTES_BOUNDS);
    assertNumRange(quoteDate, "quoteDate", DATE_BOUNDS);
    assertNumRange(validityDays, "validityDays", { ...QUOTE_VALIDITY_BOUNDS, integer: true });

    const { project, revision, label, existing, quoteId, targetVersionId, isLive } = await prepareSend(ctx, {
      organizationId, projectId, id, recipientContactId, versionId, now,
    });

    const config = await resolveOrgQuoteConfig(ctx, organizationId);
    const days = validityDays ?? config.quoteValidityDays;
    // Normalise to the org's calendar day so the printed date (and the validity
    // window derived from it) doesn't shift with the sender's browser clock.
    const stampedQuoteDate = startOfDayInTimezone(quoteDate, config.timezone);
    const validUntil = computeValidUntil(stampedQuoteDate, days, config.timezone);

    const snapshot = await buildQuoteSnapshot(ctx, project, notes, targetVersionId);
    const snapshotId = await captureProjectSnapshot(ctx, {
      orgId: organizationId, project, reason: "QUOTE_SENT", revision, actor, now,
    });
    // #1233 (D19) — scoped to `targetVersionId`: sending version B never
    // supersedes version A's quote. A same-LIVE-version newer revision (the
    // OLDER `newVersionNative` draft-cutting lineage) still supersedes.
    await supersedeLiveQuotes(ctx, organizationId, projectId, quoteId, targetVersionId, project, now);

    // #1233 (was: "not is this the FIRST send", now: "is TARGET VERSION the
    // LIVE one"), per D55 — sending a NON-live (speculative) version's quote
    // must never freeze the live job's pricing.
    await raisePricingLockIfLiveSend(ctx, { project, isLive, actor, now });

    const sendFields = {
      status: "SENT" as const,
      snapshot,
      snapshotId,
      // #1233 — stamped on EVERY send (new row or reused-on-resend), so a
      // pre-Phase-6 row gets backfilled the moment it's next sent, and
      // `quoteTargetsLiveVersion`/`findQuoteForVersion` always have a real
      // value to read going forward.
      versionId: targetVersionId,
      quoteDate: stampedQuoteDate,
      validUntil,
      validityDays: days,
      recipientContactId,
      notes,
      sentAt: now,
      sentById: actor.userId,
      // A re-send after a recall clears the recall marker on the row itself; the
      // audit log keeps the history.
      recalledAt: undefined,
      recalledById: undefined,
      recallReason: undefined,
      // Only meaningful when the revision actually carries a label — checking
      // requested doesn't ask for the tail sentence, and stamping this
      // without a label to print would be dead metadata (design §4.4).
      labelOnDocument: labelOnDocument && existing?.label ? true : undefined,
      updatedAt: now,
    };
    await persistSentQuoteRow(ctx, { project, existing, quoteId, organizationId, projectId, revision, isLive, actor, now, sendFields });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_SENT",
      entityType: "quote",
      entityId: quoteId,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Sent quote ${label}${isLive ? "" : " (non-live version)"}`,
      details: { version: revision, versionId: targetVersionId, isLive, quoteDate: stampedQuoteDate, validUntil, total: snapshot.total },
      projectId,
      createdAt: now,
    });

    // #1160 — the job moves itself to QUOTED. `offerStatusChange` is kept, but is
    // now only ever non-null when the automation did NOT act (the org opted out),
    // so the send dialog's "Move it to QUOTED?" prompt is the fallback rather than
    // the normal path. Status is still never decided by the browser either way.
    const autoStatus = await maybeAutoAdvanceProjectStatus(ctx, {
      orgId: organizationId, projectId, trigger: "QUOTE_SENT", actor, now,
    });

    return {
      id: quoteId,
      version: revision,
      validUntil,
      autoStatusChange: autoStatus === "QUOTED" ? ("QUOTED" as const) : null,
      offerStatusChange:
        autoStatus === null && SEND_OFFERS_QUOTED_FROM.has(project.status ?? "") ? ("QUOTED" as const) : null,
    };
  },
});

/**
 * RECALL — un-send, for the pre-client typo fix. `SENT → DRAFT` on the same
 * revision (the number is never reused or skipped). The stored artifact is
 * RETAINED, never deleted — the client may already be holding it, so destroying
 * our copy would make the record worse, not better — but it IS unlinked from
 * `pdfFileId` (moved to `recalledPdfFileIds`) so the next send is forced through
 * a real render instead of `attachQuoteArtifact`'s "already attached" guard
 * silently handing back the pre-recall bytes (#1027 — confirmed live bug: notes/
 * discount edited after a recall didn't show up in the "regenerated" PDF because
 * nothing cleared this field across the recall→resend cycle).
 *
 * #1229 Phase 3 — no longer restores whatever this send superseded. Before
 * this phase, recalling v2 put the revision it displaced (v1) back to `SENT`;
 * that assumed send-supersedes-across-REVISIONS, which stops being the model
 * once versioning moves onto the real `projectVersions` table
 * (`convex/versions.ts`). `restoredQuoteId` stays in the return shape
 * (always `null` now) so this is an additive-only change for any caller.
 *
 * Narrower audience than the other verbs (decision 11): `invoice:publish` AND
 * `canUnlockPricing` (D42 — the renamed `isHardLockOverrideAllowed`).
 */
export const recallNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), restoredQuoteId: v.union(v.string(), v.null()) }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    reason: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, reason, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);
    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);
    await requireCanUnlockPricing(ctx, organizationId, project.id, actor.userId);

    const trimmed = reason.trim();
    assertStrLen(trimmed, "reason", RECALL_REASON_BOUNDS);

    const label = quoteLabel(project.projectNumber, quote.version);
    assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["SENT", "EXPIRED"], label, "recall");

    // Unlink (never discard) the attached artifact so a resend is forced
    // through a real render (#1027) instead of attachQuoteArtifact's
    // "already attached" guard silently keeping the pre-recall bytes.
    const recalledPdfFileIds = quote.pdfFileId
      ? [...(quote.recalledPdfFileIds ?? []), quote.pdfFileId]
      : quote.recalledPdfFileIds;

    await ctx.db.patch(quote._id, {
      status: "DRAFT",
      recalledAt: now,
      recalledById: actor.userId,
      recallReason: trimmed,
      pdfFileId: undefined,
      recalledPdfFileIds,
      updatedAt: now,
    });

    // D56 (#1230, generalised #1233) — the mirror of sendNative's D55: clears
    // the lock only for the LIVE VERSION's quote (`quoteTargetsLiveVersion`,
    // versionId-aware with a revision-number fallback for pre-#1233 rows).
    // Recalling an older, already-superseded-past revision (v1 still SENT
    // while `newVersionNative` has since moved `liveRevision` to v2), or a
    // NON-live version's own quote, must never unlock the live job.
    const clearedPricingLock = quoteTargetsLiveVersion(quote, project) && project.pricingLocked === true;
    if (clearedPricingLock) {
      await ctx.db.patch(project._id, {
        pricingLocked: false,
        pricingLockedAt: undefined,
        pricingLockedById: undefined,
        pricingLockedByName: undefined,
      });
    }

    // #1229 Phase 3 — the un-supersede branch that used to live here
    // ("with v2 recalled, v1 is once again the document the client is
    // holding") was REMOVED: it assumed send-supersedes-across-REVISIONS,
    // which stops being the model once versioning moves onto the real
    // `projectVersions` table (`convex/versions.ts`) — a recalled revision no
    // longer implicitly un-supersedes whatever it displaced. `restoredQuoteId`
    // is kept in the return shape (always `null` now) rather than removed,
    // so this stays an additive-only change for any existing caller.
    const restoredQuoteId: string | null = null;

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_RECALLED",
      entityType: "quote",
      entityId: quote.id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Recalled quote ${label}${clearedPricingLock ? " — pricing unlocked" : ""}`,
      details: { version: quote.version, restoredQuoteId },
      metadata: clearedPricingLock ? { reason: trimmed, pricingUnlocked: true } : { reason: trimmed },
      projectId: project.id,
      createdAt: now,
    });

    return { id: quote.id, version: quote.version, restoredQuoteId };
  },
});

/**
 * NEW VERSION — the unlock. Increments `projects.revision` (and moves
 * `projects.liveRevision` alongside it, #1085) and opens a `DRAFT` quote at
 * the new number. The previous `SENT`/`ACCEPTED` row is deliberately left
 * alone: it stays the client's current document until the new revision is
 * actually sent.
 *
 * Requires the current LIVE revision to have been sent (in any terminal
 * state) — cutting v2 while v1 is still a draft would break "at most one live
 * DRAFT, always at `projects.liveRevision`". Edit the draft instead.
 *
 * #1085 — before moving off it, captures the outgoing live revision as a
 * `VERSION_SAVED` snapshot, so a revision that's about to stop being live
 * always has a fresh capture behind it. (The older `projectVersionsWrites.
 * saveVersionNative`, which made this same kind of capture explicitly on
 * demand, was deleted in #1229 Phase 3 — this mutation's own capture step is
 * unaffected and untouched by that deletion.)
 */
export const newVersionNative = mutation({
  returns: v.object({ id: v.string(), version: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_QUOTE", message: "Templates don't have quotes." });
    }
    // #1230: cutting a new version is never gated by `pricingLocked` either —
    // it copies the outgoing revision's snapshot and opens a fresh DRAFT, it
    // doesn't set any LOCKED_*_FIELDS itself. `pricingLocked` deliberately
    // stays set across this call (D57 — "this job has a quote out" is still
    // true; only a person lowers it via `unlockPricingNative`).

    const revision = projectRevision(project);
    const liveRevision = projectLiveRevision(project);
    const current = await findQuoteAtRevision(ctx, organizationId, projectId, liveRevision);
    if (!current || effectiveQuoteStatus(current, now) === "DRAFT") {
      throw new ConvexError({
        code: "QUOTE_DRAFT_OPEN",
        message: `Quote v${liveRevision} hasn't been sent yet — edit that draft instead of creating v${revision + 1}.`,
      });
    }

    const next = revision + 1;
    // Monotonicity belt-and-braces: a row already sitting at the next number
    // would mean `projects.revision` had drifted backwards. Never overwrite it.
    if (await findQuoteAtRevision(ctx, organizationId, projectId, next)) {
      throw new ConvexError({
        code: "QUOTE_VERSION_CONFLICT",
        message: `Quote v${next} already exists for this project.`,
      });
    }
    const dup = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError({ code: "DUPLICATE", message: "Quote already exists" });

    // Capture the outgoing live revision before moving past it (#1085) — see
    // the docstring above. `current` is guaranteed non-null and non-DRAFT here.
    const snapshotId = await captureProjectSnapshot(ctx, {
      orgId: organizationId,
      project,
      reason: "VERSION_SAVED",
      revision: liveRevision,
      actor,
      now,
    });
    await ctx.db.patch(current._id, { snapshotId, updatedAt: now });

    await ctx.db.patch(project._id, { revision: next, liveRevision: next, updatedAt: now });
    // A draft carries NO money snapshot — its figures are the project's live
    // totals until the moment it is sent. Freezing them now would be a lie that
    // drifts silently (`snapshot` is only ever written by `sendNative`).
    await ctx.db.insert("quotes", {
      id,
      organizationId,
      projectId,
      version: next,
      status: "DRAFT",
      snapshot: null,
      createdById: actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    const label = quoteLabel(project.projectNumber, next);
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_CREATED",
      entityType: "quote",
      entityId: id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Started quote ${label}`,
      details: { version: next, previousVersion: liveRevision, capturedSnapshotId: snapshotId },
      projectId,
      createdAt: now,
    });

    return { id, version: next };
  },
});

/** Everything `deleteRecalledNative` must confirm before it starts writing —
 *  split out so the handler reads as a straight line (R-3.6, same reasoning as
 *  `prepareSend`). Order matters: state, then never-sent, then the typed
 *  confirmation last — so a caller fixing one rejection at a time sees the
 *  real blocker first rather than a confirmation prompt for an action that
 *  was never going to be allowed anyway. (#1230 — the `protected` check that
 *  used to sit here is gone along with the whole protect/unprotect mechanism.) */
function assertRecalledDeletable(
  quote: Doc<"quotes">,
  label: string,
  confirmLabel: string,
  now: number,
): void {
  assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["DRAFT"], label, "delete");
  if (quote.sentAt == null && quote.publishedAt == null) {
    throw new ConvexError({
      code: "QUOTE_NEVER_SENT",
      message: `${label} was never sent — use the ordinary draft delete instead.`,
    });
  }
  if (confirmLabel !== label) {
    throw new ConvexError({
      code: "CONFIRMATION_MISMATCH",
      message: `Type "${label}" exactly to confirm — this permanently deletes a document the client may already hold.`,
    });
  }
}

/** Used by `deleteRecalledNative` below. (Its other caller, `deleteDraftNative`,
 *  was deleted in #1229 Phase 3 alongside the older `quotes`-row "delete a
 *  version" verbs — replaced by `versions.deleteNative` on the real
 *  `projectVersions` table — leaving this with a single caller; kept as its
 *  own function anyway, R-3.6.) The revision a project should fall back to
 *  once `excludeQuoteId` is gone — the highest revision, among what's left,
 *  that was ever actually sent, or `1` if none was. */
async function computeRevisionRollback(
  ctx: MutationCtx,
  organizationId: string,
  projectId: string,
  excludeQuoteId: string,
): Promise<number> {
  const others = (await listProjectQuotes(ctx, organizationId, projectId)).filter((q) => q.id !== excludeQuoteId);
  const everSentVersions = others
    .filter((q) => q.sentAt != null || q.publishedAt != null)
    .map((q) => q.version);
  return everSentVersions.length > 0 ? Math.max(...everSentVersions) : 1;
}

/**
 * SET LABEL (#1080/#1097) — rename a version's internal name from the row.
 * Reachable on any revision (live or not, sent or not) — the label is
 * metadata, never a behavioural switch, same reasoning as `convex/versions.ts`'s
 * `createNative`/`setLabelNative` label arguments, whose bound (`LABEL_BOUNDS`,
 * `convex/projectVersionsWrites.ts`) this shares rather than duplicating
 * (R-3.1). Passing `undefined`/an empty string clears it.
 */
export const setQuoteLabelNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), label: v.union(v.string(), v.null()) }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    label: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, label, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);
    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);

    const trimmed = label?.trim() || undefined;
    assertStrLen(trimmed, "label", LABEL_BOUNDS);

    const revisionLabel = quoteLabel(project.projectNumber, quote.version);
    await ctx.db.patch(quote._id, { label: trimmed, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_LABEL_SET",
      entityType: "quote",
      entityId: quote.id,
      entityName: revisionLabel,
      userId: actor.userId,
      userName: actor.userName,
      summary: trimmed ? `Labelled ${revisionLabel} "${trimmed}"` : `Cleared ${revisionLabel}'s label`,
      details: { version: quote.version, label: trimmed ?? null },
      projectId: project.id,
      createdAt: now,
    });

    return { id: quote.id, version: quote.version, label: trimmed ?? null };
  },
});

/** The client-supplied field set for `setQuoteLabelNative`, mirrored to Zod
 *  (`quoteSetLabelSchema` in `src/lib/validations/quote.ts`). */
export const quoteSetLabelFields = {
  label: v.optional(v.string()),
};

/**
 * RECALL-THEN-DELETE (#1029) — the one deliberate reversal of the earlier
 * program-wide rule that a sent quote's document is never truly deleted. This
 * is a two-step flow BY DESIGN: `recallNative` un-sends first (its own audience
 * and reason requirement apply there), and only once the row is sitting in
 * `DRAFT` with send history does this mutation become reachable at all — there
 * is no path that skips the recall.
 *
 * **Owner-only** (`requireQuoteOwnerOnly` — stricter than Recall's own
 * `canUnlockPricing` audience) and requires a server-validated typed
 * confirmation: `confirmLabel` must match the
 * revision's label EXACTLY, mirroring the client's typed-confirmation dialog so
 * a caller hitting this mutation directly (bypassing the UI) can't skip the
 * "type the version to confirm" step (R-8.6.4's browser-direct write bar).
 *
 * Unlike every other delete/recall path in this file, this one ACTUALLY erases
 * the storage bytes (`pdfFileId` and every entry in `recalledPdfFileIds`) —
 * not just unlinks them — because the whole point is a genuine, accepted-risk
 * full erase of a document a client may already hold. The audit log entry is
 * written FIRST and deliberately over-detailed (project, version, label, prior
 * artifact ids, who, when) because it is the only record left once this
 * returns.
 *
 * #1085: the revision-counter rollback below only ever fires when the
 * deleted quote IS the current live revision — same reasoning the deleted
 * (#1229 Phase 3) `deleteDraftNative`'s own live-only guard used, just
 * without refusing the call outright (this flow's audience/erase semantics
 * are otherwise unchanged).
 * Erasing an older, already-superseded sent-then-recalled revision removes
 * the row and its artifacts but leaves `revision`/`liveRevision` exactly
 * where they are — there is nothing to roll back to.
 */
export const deleteRecalledNative = mutation({
  returns: v.object({ id: v.string(), deletedVersion: v.number(), revision: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    /** Must exactly match the revision's label, e.g. "RVLT-2026-0087 v2". */
    confirmLabel: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, confirmLabel, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "quote");
    await enforceBrowserWriteLimit(ctx);
    const actor = await resolveActor(ctx, suppliedActor);
    await requireQuoteOwnerOnly(ctx, organizationId, actor.userId, "permanently delete a sent quote");

    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);
    const label = quoteLabel(project.projectNumber, quote.version);
    assertRecalledDeletable(quote, label, confirmLabel, now);

    // Only the live revision's deletion rolls the counters back — an older,
    // already-superseded revision (one a Save Version left the live pointer
    // past) has nothing for the project's current numbers to roll back to.
    const isLiveRevision = quote.version === projectLiveRevision(project);
    const rollbackTo = isLiveRevision
      ? await computeRevisionRollback(ctx, organizationId, project.id, quote.id)
      : projectRevision(project);
    const erasedArtifactIds = [...(quote.pdfFileId ? [quote.pdfFileId] : []), ...(quote.recalledPdfFileIds ?? [])];

    // Audit FIRST — this is the only record left once the row and its
    // artifacts are gone.
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_DELETED",
      entityType: "quote",
      entityId: quote.id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Permanently deleted previously-sent quote ${label} (recall-then-delete)`,
      details: {
        version: quote.version,
        rolledBackTo: rollbackTo,
        wasSentAt: quote.sentAt ?? quote.publishedAt,
        erasedArtifactCount: erasedArtifactIds.length,
      },
      metadata: { erasedArtifactIds },
      projectId: project.id,
      createdAt: now,
    });

    for (const storageId of erasedArtifactIds) {
      try {
        await ctx.storage.delete(storageId as Id<"_storage">);
      } catch {
        // Already gone — this is a genuine erase, not a retry-safe attach, so
        // a missing blob is not an error condition (deleteFile in files.ts is
        // idempotent the same way).
      }
    }

    await ctx.db.delete(quote._id);
    if (isLiveRevision && rollbackTo !== projectRevision(project)) {
      await ctx.db.patch(project._id, { revision: rollbackTo, liveRevision: rollbackTo, updatedAt: now });
    }

    return { id: quote.id, deletedVersion: quote.version, revision: rollbackTo };
  },
});

/**
 * ACCEPT — `SENT → ACCEPTED`, the thing that unblocks `CONFIRMED`
 * (`projectWrites.updateStatusNative`). An EXPIRED revision cannot be accepted:
 * the client's window closed, and re-sending is the honest way to reopen it.
 *
 * **#1233 (Phase 6, D20) — accept = make live.** Accepting a NON-live
 * version's quote first composes `performMakeLive` (`convex/lib/
 * makeLiveCore.ts` — the SAME pointer-flip code `versions.makeLiveNative`
 * runs, not a second implementation) to flip `projects.liveVersionId` onto
 * that version, THEN marks the quote accepted, THEN supersedes every other
 * OPEN (SENT/EXPIRED) quote on the project ACROSS EVERY version — enforcing
 * "at most one ACCEPTED per project, ever". Accepting the ALREADY-live
 * version's quote skips the make-live step (a no-op pointer flip would only
 * throw `VERSION_ALREADY_LIVE`) but still runs the cross-version supersede.
 *
 * **Confirmation-gate note (CLAUDE.md's agent/API rubric)** — `markAcceptedNative`
 * is already `danger: "high"` (see `agentOps` below), so the API dispatcher
 * already requires `confirm: true` before ANY call reaches this mutation.
 * Composing `performMakeLive` (itself `danger: "high"` as a standalone
 * operation) inside an ALREADY-gated `danger: "high"` call does not need a
 * SECOND confirmation layer — the one human confirmation on the accept call
 * covers both effects (they happen atomically, in the same transaction, as
 * one irreversible-feeling action from the caller's point of view). No
 * separate `agentOps` note is added for this composition; flagged here
 * instead, in the one place the composition happens.
 */
/**
 * D20's make-live-first step, split out of `markAcceptedNative`'s handler
 * (R-3.6): resolves the quote's target version (a pre-#1233 row with no
 * `versionId` always targeted the live version, by construction of the
 * OLDER system) and composes `performMakeLive` ONLY when that target isn't
 * already live. Returns `conflicts: []` (never touched) when it was.
 */
async function makeLiveIfAcceptingNonLiveQuote(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    project: Doc<"projects">;
    quote: Doc<"quotes">;
    label: string;
    actor: { userId: string; userName: string };
    now: number;
  },
): Promise<{ madeLive: boolean; conflicts: string[]; quoteVersionId: string }> {
  const { organizationId, project, quote, label, actor, now } = args;
  const liveVersionId = requireLiveVersionId(project);
  const quoteVersionId = quote.versionId ?? liveVersionId;
  if (quoteVersionId === liveVersionId) return { madeLive: false, conflicts: [], quoteVersionId };

  const result = await performMakeLive(ctx, {
    organizationId,
    projectId: project.id,
    project,
    versionId: quoteVersionId,
    actor,
    // A FRESH id — this is a second, distinct activity-log entry from the
    // accept entry, not a reuse of the caller's own `auditId`.
    auditId: createId(),
    now,
    summaryPrefix: `Accepted ${label} — made`,
  });
  return { madeLive: true, conflicts: result.conflicts, quoteVersionId };
}

/**
 * D20's cross-version supersede step, split out of `markAcceptedNative`'s
 * handler (R-3.6): every OTHER open (SENT/EXPIRED) quote on the project,
 * across EVERY version, is superseded the moment one is accepted — unlike
 * `sendNative`'s own supersede (D19, same-version only), this one is
 * deliberately cross-version. Returns how many rows it touched (folded into
 * the activity-log summary).
 */
async function supersedeOtherOpenQuotesOnAccept(
  ctx: MutationCtx,
  args: { organizationId: string; projectId: string; keepQuoteId: string; now: number },
): Promise<number> {
  const { organizationId, projectId, keepQuoteId, now } = args;
  let supersededCount = 0;
  for (const other of await listProjectQuotes(ctx, organizationId, projectId)) {
    if (other.id === keepQuoteId) continue;
    if (!isLiveQuoteStatus(effectiveQuoteStatus(other, now))) continue;
    await ctx.db.patch(other._id, { status: "SUPERSEDED", supersededByQuoteId: keepQuoteId, updatedAt: now });
    supersededCount += 1;
  }
  return supersededCount;
}

export const markAcceptedNative = mutation({
  returns: v.object({
    id: v.string(),
    version: v.number(),
    madeLive: v.boolean(),
    /** `performMakeLive`'s own conflicts list (D6's "list, don't block" —
     *  same shape `versions.makeLiveNative` returns) when accepting made a
     *  version live. Empty when the accepted version was already live. */
    conflicts: v.array(v.string()),
    /** #1236 — non-null when the automation moved the job to AWAITING_PAYMENT. */
    autoStatusChange: v.union(v.literal("AWAITING_PAYMENT"), v.null()),
    offerStatusChange: offerValidator,
  }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    /** Defaults to `now` when omitted; normalised to the org's calendar day. */
    acceptedAt: v.optional(v.number()),
    /** PO number, email subject, "verbal — call 26/7" … free text, bounded. */
    acceptanceRef: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, acceptedAt, acceptanceRef, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);
    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);

    assertStrLen(acceptanceRef, "acceptanceRef", ACCEPTANCE_REF_BOUNDS);
    assertNumRange(acceptedAt, "acceptedAt", DATE_BOUNDS);

    const label = quoteLabel(project.projectNumber, quote.version);
    assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["SENT"], label, "accept");

    const config = await resolveOrgQuoteConfig(ctx, organizationId);
    const stampedAcceptedAt = startOfDayInTimezone(acceptedAt ?? now, config.timezone);

    // D20 — accept-of-a-non-live-version's quote makes that version live
    // FIRST, so everything downstream (the activity log, the caller's
    // refetch) already sees the flip.
    const { madeLive, conflicts, quoteVersionId } = await makeLiveIfAcceptingNonLiveQuote(ctx, {
      organizationId, project, quote, label, actor, now,
    });

    await ctx.db.patch(quote._id, {
      status: "ACCEPTED",
      acceptedAt: stampedAcceptedAt,
      acceptedById: actor.userId,
      acceptanceRef: acceptanceRef?.trim() || undefined,
      updatedAt: now,
    });

    const supersededCount = await supersedeOtherOpenQuotesOnAccept(ctx, {
      organizationId, projectId: project.id, keepQuoteId: quote.id, now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_ACCEPTED",
      entityType: "quote",
      entityId: quote.id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Marked quote ${label} accepted${madeLive ? " (made its version live)" : ""}${supersededCount > 0 ? ` — superseded ${supersededCount} other open quote(s)` : ""}`,
      details: { version: quote.version, versionId: quoteVersionId, madeLive, supersededCount, acceptedAt: stampedAcceptedAt, acceptanceRef: acceptanceRef ?? null },
      projectId: project.id,
      createdAt: now,
    });

    // #1236 — accepting now moves the job to AWAITING_PAYMENT (the client has
    // said yes; the money hasn't landed), NOT straight to CONFIRMED. The old
    // "offer CONFIRMED" is the opt-out fallback, exactly as it is for send.
    const autoStatus = await maybeAutoAdvanceProjectStatus(ctx, {
      orgId: organizationId, projectId: project.id, trigger: "QUOTE_ACCEPTED", actor, now,
    });

    return {
      id: quote.id,
      version: quote.version,
      madeLive,
      conflicts,
      autoStatusChange: autoStatus === "AWAITING_PAYMENT" ? ("AWAITING_PAYMENT" as const) : null,
      offerStatusChange:
        autoStatus === null && ACCEPT_OFFERS_CONFIRMED_FROM.has(project.status ?? "")
          ? ("CONFIRMED" as const)
          : null,
    };
  },
});

/**
 * DECLINE — `SENT → DECLINED` with a bounded reason. Offers `CANCELLED` and never
 * forces it: a declined quote often becomes a re-quote, not a dead job.
 * An expired revision can still be declined — the client answering late is a real
 * outcome and recording it beats leaving the row ambiguous.
 */
export const markDeclinedNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), offerStatusChange: offerValidator }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    reason: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, reason, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);
    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);

    const trimmed = reason.trim();
    assertStrLen(trimmed, "reason", DECLINE_REASON_BOUNDS);

    const label = quoteLabel(project.projectNumber, quote.version);
    assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["SENT", "EXPIRED"], label, "decline");

    await ctx.db.patch(quote._id, {
      status: "DECLINED",
      declinedAt: now,
      declinedById: actor.userId,
      declineReason: trimmed,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_DECLINED",
      entityType: "quote",
      entityId: quote.id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Marked quote ${label} declined`,
      details: { version: quote.version },
      metadata: { reason: trimmed },
      projectId: project.id,
      createdAt: now,
    });

    return { id: quote.id, version: quote.version, offerStatusChange: "CANCELLED" as const };
  },
});

/**
 * The client-supplied field sets, exported for the Zod↔Convex parity test
 * (`convex/validationDrift.test.ts`, R-8.6.1) — each one pairs with the
 * correspondingly-named schema in `src/lib/validations/quote.ts`. Dates are
 * `Date` client-side and ms timestamps over the wire; the field NAMES match,
 * which is what parity checks.
 *
 * Note what is absent from all four — no monetary amount appears anywhere in a
 * client-supplied quote payload (R-9.3).
 */
export const quoteSendFields = {
  quoteDate: v.number(),
  validityDays: v.optional(v.number()),
  recipientContactId: v.optional(v.string()),
  notes: v.optional(v.string()),
  labelOnDocument: v.optional(v.boolean()),
};
export const quoteRecallFields = { reason: v.string() };
export const quoteAcceptFields = {
  acceptedAt: v.optional(v.number()),
  acceptanceRef: v.optional(v.string()),
};
export const quoteDeclineFields = { reason: v.string() };

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  // Client-facing, hard-to-silently-undo state changes on the document the
  // client is holding — the send/accept/decline/recall quartet is high even
  // though each has an in-app "undo" path (recall un-sends, a new version
  // supersedes) — the classification tracks §9's stated categories.
  markAcceptedNative: { danger: "high" },
  markDeclinedNative: { danger: "high" },
  // Internal metadata only (never printed unless labelOnDocument is also set
  // at send) — same risk class as versions.setLabelNative's own argument.
  setQuoteLabelNative: { danger: "low" },
  // Genuinely irreversible — the one mutation in this file that deletes
  // storage bytes a client may already hold, not just unlinks/preserves them.
  deleteRecalledNative: { danger: "high" },
  // Cuts a fresh DRAFT at the next revision — the prior SENT/ACCEPTED quote the
  // client is holding is left untouched until that draft is itself sent.
  newVersionNative: { danger: "medium" },
  // Un-sends AND, per D56, may clear projects.pricingLocked — lock-softening,
  // same rubric as unlockPricingNative.
  recallNative: { danger: "high" },
  // Freezes pricing (raises projects.pricingLocked, D55) and produces the
  // document the client is holding.
  sendNative: { danger: "high" },
};
