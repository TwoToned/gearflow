import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNumRange, assertStrLen } from "./lib/fieldGuards";
import { assertClientContactBelongsToClient, assertRefInOrg } from "./lib/orgRef";
import { assertLifecycleGuard, requireHardLockOverrideAllowed } from "./lib/projectLocks";
import { captureProjectSnapshot } from "./lib/projectSnapshots";
import { buildFinanceLines } from "./lib/financeSnapshot";
import { resolveOrgQuoteConfig } from "./lib/orgSettings";
import { computeValidUntil, startOfDayInTimezone, QUOTE_VALIDITY_BOUNDS } from "./lib/quoteDates";
import {
  effectiveQuoteStatus,
  findQuoteAtRevision,
  isLiveQuoteStatus,
  listProjectQuotes,
  projectLiveRevision,
  projectRevision,
  quoteLabel,
  requireProjectInOrg,
  requireQuoteInOrg,
  requireQuoteOwnerOnly,
  type EffectiveQuoteStatus,
} from "./lib/quoteState";
import { LABEL_BOUNDS } from "./projectVersionsWrites";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Quote revision mutations (#986 — Phase A of the finance version-control
 * program). Send / recall / new-version / accept / decline / unaccept /
 * correct / recall-then-delete over ONE shared counter, `projects.revision`:
 *
 * ```
 *   v1 DRAFT ─ send ─▶ v1 SENT ─ accept ─▶ v1 ACCEPTED ─▶ project may CONFIRM
 *        ▲               │ │ │  ◀── unaccept ──┘
 *        └─ recall ──────┘ │ └─ decline ─▶ v1 DECLINED
 *                          └─ new version ─▶ v2 DRAFT  (v1 → SUPERSEDED on v2's send)
 * ```
 *
 * **#1229 Phase 3 note.** This file used to also carry `deleteDraftNative`
 * (#1028, undid a fat-fingered "new version") and `deleteVersionNative`
 * (#1097, deleted a saved-but-never-sent version) plus `setQuoteProtectedNative`
 * (#1030) and `repriceFromRevisionNative` (#989) — all DELETED in Phase 3 of
 * "Project versioning v2" (parent #1221), superseded by the real
 * `projectVersions`-table verb set in `convex/versions.ts`
 * (`createNative`/`makeLiveNative`/`setLabelNative`/`deleteNative`). See
 * FEATUREDOCS/76's Phase 3 section. The `protected` field and the checks
 * against it in `recallNative`/`deleteRecalledNative`/`correctQuoteNative`
 * below are UNCHANGED (still enforced on any row that already has it set) —
 * only the mutation that let a caller SET/CLEAR it is gone, so a
 * pre-existing protected row can no longer be unprotected through this API.
 *
 * Properties this file still guarantees, each with a test in
 * `quotesWrites.test.ts`:
 *
 * - **Exactly one quote row per `(projectId, revision)`** — `by_projectId_version`
 *   is the uniqueness guard.
 * - **At most one live (`SENT`/`ACCEPTED`) row** — the document the client is
 *   currently holding.
 * - **`projects.revision` is monotonic for any revision that was ever SENT** —
 *   never decremented, never reused. A recalled-then-re-sent revision keeps
 *   its number.
 * - **Supersede fires on SEND, not on draft.** v1 stays `SENT` while v2 is a
 *   draft, so cutting a draft never invalidates the client's document. That is
 *   the difference between version control and a delete button. (Recall no
 *   longer un-supersedes a displaced revision on the way back — #1229 Phase 3
 *   removed that branch; see `recallNative`'s own comment.)
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
 * **Permissions (decision 11).** Send / new-version / accept / decline / unaccept
 * check `invoice:publish` (owner/admin/manager). **Recall additionally requires
 * `isHardLockOverrideAllowed`** (org admin/owner, or one of the project's
 * `projectManagers`) — un-sending a document the client may already be holding is
 * trust-sensitive in a way the other verbs are not. **Unaccept is deliberately
 * symmetric with Accept** (same audience, not the narrower owner-only bar
 * Correct uses) — it reverses the very action that audience just took, not a
 * separate "mutate a document a client may hold" decision. No new permission
 * resource is introduced.
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
 *  all five; recall layers `requireHardLockOverrideAllowed` on top. */
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

/** The money snapshot frozen onto a revision at send. Built entirely server-side
 *  from `buildFinanceLines` + the project's recalc-owned totals (R-9.3). */
async function buildQuoteSnapshot(
  ctx: MutationCtx,
  project: Doc<"projects">,
  notes: string | undefined,
): Promise<Record<string, unknown>> {
  const lines = await buildFinanceLines(ctx, project.id, project.organizationId);
  return {
    lines,
    subtotal: Number(project.subtotal) || 0,
    discountPercent: Number(project.discountPercent) || 0,
    discountAmount: Number(project.discountAmount) || 0,
    taxRate: project.taxRate != null ? Number(project.taxRate) : null,
    taxAmount: Number(project.taxAmount) || 0,
    total: Number(project.total) || 0,
    notes: notes ?? null,
  };
}

/**
 * Everything `sendNative` must establish before it starts writing: the project is
 * real, in-org, not a template, not hard-locked; the recipient (if any) belongs to
 * this project's client; the current revision has an editable draft (or none yet);
 * and the client-minted id isn't a duplicate. Split out of the handler so the
 * write path reads as a straight line (R-3.6).
 */
async function prepareSend(
  ctx: MutationCtx,
  args: { organizationId: string; projectId: string; id: string; recipientContactId?: string; now: number },
): Promise<{ project: Doc<"projects">; revision: number; label: string; existing: Doc<"quotes"> | null; quoteId: string }> {
  const { organizationId, projectId, id, recipientContactId, now } = args;

  await assertRefInOrg(ctx, "projects", projectId, organizationId);
  const project = await requireProjectInOrg(ctx, projectId, organizationId);
  if (project.isTemplate) {
    throw new ConvexError({ code: "TEMPLATE_QUOTE", message: "Templates don't have quotes." });
  }
  // Same financial gate every money-touching mutation uses, so a hard-locked
  // (or status-FINANCE_LOCKED, e.g. CONFIRMED+) project can't emit a quote out
  // of band. `bypassQuoteLock: true` (#988) because THIS is the mutation that
  // freezes the current revision's own quote lock — gating it against its own
  // not-yet-sent state would be a no-op (a fresh/DRAFT revision never raises
  // the tier anyway) and gating a RESEND against the revision's own prior SENT
  // state would be a chicken-and-egg deadlock. STATUS-driven tiers (CONFIRMED+
  // / ON_SITE+ / COMPLETED+) are unaffected by this flag and still gate normally.
  await assertLifecycleGuard(ctx, project, { kind: "financial", bypassQuoteLock: true });

  // The recipient must belong to THIS project's client — otherwise a caller could
  // stamp another client's contact onto the revision and leak their PII onto the
  // document (the same check the project's own contact picker makes).
  if (recipientContactId) {
    if (!project.clientId) {
      throw new ConvexError({ code: "INVALID_FIELD", message: "Assign a client before choosing a recipient." });
    }
    await assertClientContactBelongsToClient(ctx, recipientContactId, project.clientId, organizationId);
  }

  // #1080/#1097 — the row a send freezes is whichever revision is LIVE, not
  // necessarily the allocator's high-water mark: the OLDER `promoteRevisionNative`
  // (deleted in #1229 Phase 3) could point `liveRevision` at an older number
  // while `revision` stayed ahead of it, and a project promoted under that
  // now-gone mutation may still carry a decoupled pair. `newVersionNative`
  // already keys off `liveRevision` for the same reason — this keeps
  // `sendNative` in line so such a row still sends the right revision rather
  // than silently targeting the wrong one.
  const revision = projectLiveRevision(project);
  const label = quoteLabel(project.projectNumber, revision);
  const existing = await findQuoteAtRevision(ctx, organizationId, projectId, revision);
  if (existing) {
    if (effectiveQuoteStatus(existing, now) !== "DRAFT") {
      throw new ConvexError({
        code: "QUOTE_ALREADY_SENT",
        message: `${label} has already been sent. Create v${revision + 1} to change it.`,
      });
    }
  } else {
    // `by_cuid` is global and non-unique — dup-guard the client-minted id.
    const dup = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError({ code: "DUPLICATE", message: "Quote already exists" });
  }

  return { project, revision, label, existing, quoteId: existing?.id ?? id };
}

/** Supersede-on-SEND (never on draft): whatever the client was holding stops
 *  being the current document the moment a newer revision goes out. */
async function supersedeLiveQuotes(
  ctx: MutationCtx,
  orgId: string,
  projectId: string,
  keepQuoteId: string,
  now: number,
): Promise<void> {
  for (const other of await listProjectQuotes(ctx, orgId, projectId)) {
    if (other.id === keepQuoteId) continue;
    if (!isLiveQuoteStatus(effectiveQuoteStatus(other, now))) continue;
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
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, organizationId, projectId, quoteDate, validityDays, recipientContactId, notes, labelOnDocument, auditId, now } = args;
    const actor = await guardQuoteWrite(ctx, organizationId, args.actor);

    assertStrLen(notes, "notes", NOTES_BOUNDS);
    assertNumRange(quoteDate, "quoteDate", DATE_BOUNDS);
    assertNumRange(validityDays, "validityDays", { ...QUOTE_VALIDITY_BOUNDS, integer: true });

    const { project, revision, label, existing, quoteId } = await prepareSend(ctx, {
      organizationId, projectId, id, recipientContactId, now,
    });

    const config = await resolveOrgQuoteConfig(ctx, organizationId);
    const days = validityDays ?? config.quoteValidityDays;
    // Normalise to the org's calendar day so the printed date (and the validity
    // window derived from it) doesn't shift with the sender's browser clock.
    const stampedQuoteDate = startOfDayInTimezone(quoteDate, config.timezone);
    const validUntil = computeValidUntil(stampedQuoteDate, days, config.timezone);

    const snapshot = await buildQuoteSnapshot(ctx, project, notes);
    const snapshotId = await captureProjectSnapshot(ctx, {
      orgId: organizationId, project, reason: "QUOTE_SENT", revision, actor, now,
    });
    await supersedeLiveQuotes(ctx, organizationId, projectId, quoteId, now);

    const sendFields = {
      status: "SENT" as const,
      snapshot,
      snapshotId,
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
    if (existing) {
      await ctx.db.patch(existing._id, sendFields);
    } else {
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

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_SENT",
      entityType: "quote",
      entityId: quoteId,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Sent quote ${label}`,
      details: { version: revision, quoteDate: stampedQuoteDate, validUntil, total: snapshot.total },
      projectId,
      createdAt: now,
    });

    return {
      id: quoteId,
      version: revision,
      validUntil,
      offerStatusChange: SEND_OFFERS_QUOTED_FROM.has(project.status ?? "") ? ("QUOTED" as const) : null,
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
 * `isHardLockOverrideAllowed`.
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
    await requireHardLockOverrideAllowed(ctx, organizationId, project.id, actor.userId);

    const trimmed = reason.trim();
    assertStrLen(trimmed, "reason", RECALL_REASON_BOUNDS);

    const label = quoteLabel(project.projectNumber, quote.version);
    assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["SENT", "EXPIRED"], label, "recall");
    if (quote.protected) {
      throw new ConvexError({
        code: "QUOTE_PROTECTED",
        message: `${label} is protected — an owner must unprotect it before it can be recalled.`,
      });
    }

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
      summary: `Recalled quote ${label}`,
      details: { version: quote.version, restoredQuoteId },
      metadata: { reason: trimmed },
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
    // `bypassQuoteLock: true` (#988) — THIS is the sanctioned exit from a
    // quote-derived lock ("cutting a new version is the unlock", decision 2).
    // At call time the current revision is still the live SENT/ACCEPTED/etc.
    // quote this mutation is about to move past, so gating against its own
    // escalation would make the unlock action unreachable. STATUS-driven tiers
    // (CONFIRMED+/ON_SITE+/COMPLETED+) still gate normally.
    await assertLifecycleGuard(ctx, project, { kind: "financial", bypassQuoteLock: true });

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
 *  `prepareSend`). Order matters: state, then never-sent, then protected, then
 *  the typed confirmation last — so a caller fixing one rejection at a time
 *  sees the real blocker first rather than a confirmation prompt for an action
 *  that was never going to be allowed anyway. */
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
  if (quote.protected) {
    throw new ConvexError({
      code: "QUOTE_PROTECTED",
      message: `${label} is protected — an owner must unprotect it before it can be deleted.`,
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
 * admin/owner/PM audience), **blocked while `protected: true`** (an owner must
 * explicitly unprotect first — protection is the stronger guarantee), and
 * requires a server-validated typed confirmation: `confirmLabel` must match the
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
 */
export const markAcceptedNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), offerStatusChange: offerValidator }),
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

    await ctx.db.patch(quote._id, {
      status: "ACCEPTED",
      acceptedAt: stampedAcceptedAt,
      acceptedById: actor.userId,
      acceptanceRef: acceptanceRef?.trim() || undefined,
      // #1030 — a client has committed to these exact numbers; protect the
      // revision by default. #1229 Phase 3 deleted `setQuoteProtectedNative`
      // (the only mutation that could clear this) — there is currently no
      // way to unprotect an accepted revision through this API; `unaccept`
      // below clears it as a side effect of reversing the acceptance itself.
      protected: true,
      protectedAt: now,
      protectedById: actor.userId,
      updatedAt: now,
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
      summary: `Marked quote ${label} accepted`,
      details: { version: quote.version, acceptedAt: stampedAcceptedAt, acceptanceRef: acceptanceRef ?? null },
      projectId: project.id,
      createdAt: now,
    });

    return {
      id: quote.id,
      version: quote.version,
      offerStatusChange: ACCEPT_OFFERS_CONFIRMED_FROM.has(project.status ?? "") ? ("CONFIRMED" as const) : null,
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
 * UNACCEPT (#1032) — the reverse of Accept: `ACCEPTED → SENT`, restoring the
 * pre-accept state. For the "accepted too soon" case — a client verbally
 * agreed then asked for a change, or a PM fat-fingered the button — recalling
 * (which only reaches `SENT`/`EXPIRED`) can't undo an acceptance, so this
 * fills that "fat-fingered the button" gap for Accept specifically.
 *
 * Clears the acceptance fields (`acceptedAt`/`acceptedById`/`acceptanceRef`)
 * AND the `protected` flag that Accept auto-set (#1030) in the SAME step —
 * protection existed only because this revision was accepted, so unaccepting
 * removes both together rather than requiring a separate unprotect first. This
 * is why unaccept, unlike Recall/Correction/recall-then-delete, is reachable
 * even while `protected: true`: it's undoing the exact action that set it.
 *
 * Deliberately does NOT touch the project's status. `hasAcceptedQuote` simply
 * reads false again afterwards — same as when a new version supersedes an
 * accepted revision. An already-`CONFIRMED` project stays `CONFIRMED`; the gate
 * in `projectWrites.updateStatusNative` only fires on the transition itself.
 */
export const unacceptNative = mutation({
  returns: v.object({ id: v.string(), version: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);
    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);

    const label = quoteLabel(project.projectNumber, quote.version);
    assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["ACCEPTED"], label, "unapprove");

    await ctx.db.patch(quote._id, {
      status: "SENT",
      acceptedAt: undefined,
      acceptedById: undefined,
      acceptanceRef: undefined,
      protected: false,
      protectedAt: undefined,
      protectedById: undefined,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_UNACCEPTED",
      entityType: "quote",
      entityId: quote.id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Unapproved quote ${label}`,
      details: { version: quote.version },
      projectId: project.id,
      createdAt: now,
    });

    return { id: quote.id, version: quote.version };
  },
});

/**
 * CORRECTION (#1031) — an audited in-place fix to a `SENT`/`ACCEPTED`
 * revision's `quoteDate`/`validUntil`, no version bump, no price change. This
 * is deliberately narrower than it might sound: it does NOT touch `sentAt`
 * (the system's true record of when the send actually happened — only the
 * date PRINTED ON THE DOCUMENT is correctable), and it does NOT touch
 * `snapshot`/pricing/structure at all — that's what New Version is for.
 *
 * Same shape as the recall path for the attached artifact: `pdfFileId` is
 * unlinked (pushed onto `recalledPdfFileIds`, never discarded) so the next
 * render is forced fresh rather than serving the pre-correction bytes. The PDF
 * itself isn't re-rendered here — that's the Node-side server action's job
 * (`generateQuoteArtifact`, `src/server/finance-documents.ts`), same division
 * of labour `sendNative` already has with its own auto-render step. The
 * "REISSUED — corrects vN sent X, edited by Y on Z" watermark on the reissued
 * PDF is separate follow-up work in the PDF pipeline (`document-layouts.ts` /
 * `document-composer.ts`), not built by this mutation.
 *
 * Owner-only (`requireQuoteOwnerOnly`) and blocked while `protected: true` —
 * same bar as recall-then-delete: this mutates a document a client may
 * already hold, so it gets the higher of the two audiences discussed for it
 * rather than Recall's narrower one.
 */
export const correctQuoteNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), quoteDate: v.number(), validUntil: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    /** The corrected date to print on the document. */
    quoteDate: v.number(),
    /** Defaults to the revision's own `validityDays`, then the org default. */
    validityDays: v.optional(v.number()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, quoteDate, validityDays, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "quote");
    await enforceBrowserWriteLimit(ctx);
    const actor = await resolveActor(ctx, suppliedActor);
    await requireQuoteOwnerOnly(ctx, organizationId, actor.userId, "correct a sent quote's date");

    assertNumRange(quoteDate, "quoteDate", DATE_BOUNDS);
    assertNumRange(validityDays, "validityDays", { ...QUOTE_VALIDITY_BOUNDS, integer: true });

    const { quote, project } = await loadQuoteAndProject(ctx, id, organizationId);
    const label = quoteLabel(project.projectNumber, quote.version);
    assertQuoteStatusIs(effectiveQuoteStatus(quote, now), ["SENT", "ACCEPTED"], label, "correct");
    if (quote.protected) {
      throw new ConvexError({
        code: "QUOTE_PROTECTED",
        message: `${label} is protected — an owner must unprotect it before it can be corrected.`,
      });
    }

    const config = await resolveOrgQuoteConfig(ctx, organizationId);
    const days = validityDays ?? quote.validityDays ?? config.quoteValidityDays;
    const stampedQuoteDate = startOfDayInTimezone(quoteDate, config.timezone);
    const newValidUntil = computeValidUntil(stampedQuoteDate, days, config.timezone);

    // Same unlink-not-discard shape as recall (#1027): forces the next render
    // through a real render instead of attachQuoteArtifact's guard silently
    // keeping the pre-correction bytes attached under a since-corrected date.
    const recalledPdfFileIds = quote.pdfFileId
      ? [...(quote.recalledPdfFileIds ?? []), quote.pdfFileId]
      : quote.recalledPdfFileIds;

    await ctx.db.patch(quote._id, {
      quoteDate: stampedQuoteDate,
      validUntil: newValidUntil,
      validityDays: days,
      pdfFileId: undefined,
      recalledPdfFileIds,
      correctedAt: now,
      correctedById: actor.userId,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_CORRECTED",
      entityType: "quote",
      entityId: quote.id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Corrected quote ${label}'s date`,
      details: {
        version: quote.version,
        previousQuoteDate: quote.quoteDate ?? null,
        newQuoteDate: stampedQuoteDate,
        previousValidUntil: quote.validUntil ?? null,
        newValidUntil,
      },
      projectId: project.id,
      createdAt: now,
    });

    return { id: quote.id, version: quote.version, quoteDate: stampedQuoteDate, validUntil: newValidUntil };
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
  // Mutates dates on a document a client may already hold, forcing a re-render
  // under the same revision number — same risk class as recall/send.
  correctQuoteNative: { danger: "high" },
  // Cuts a fresh DRAFT at the next revision — the prior SENT/ACCEPTED quote the
  // client is holding is left untouched until that draft is itself sent.
  newVersionNative: { danger: "medium" },
  recallNative: { danger: "high" },
  sendNative: { danger: "high" },
  // Reverses a recorded client acceptance and drops it out of hasAcceptedQuote
  // — same risk class as the accept/decline/recall quartet it undoes.
  unacceptNative: { danger: "high" },
};
