import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertNumRange, assertStrLen } from "./lib/fieldGuards";
import { assertClientContactBelongsToClient, assertRefInOrg } from "./lib/orgRef";
import { assertLifecycleGuard, requireHardLockOverrideAllowed } from "./lib/projectLocks";
import { captureProjectSnapshot, restoreProjectSnapshot } from "./lib/projectSnapshots";
import { buildFinanceLines } from "./lib/financeSnapshot";
import { recalcProjectTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate, resolveOrgQuoteConfig } from "./lib/orgSettings";
import { computeValidUntil, startOfDayInTimezone, QUOTE_VALIDITY_BOUNDS } from "./lib/quoteDates";
import {
  effectiveQuoteStatus,
  findQuoteAtRevision,
  isLiveQuoteStatus,
  listProjectQuotes,
  projectRevision,
  quoteLabel,
  requireProjectInOrg,
  requireQuoteInOrg,
  type EffectiveQuoteStatus,
} from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Quote revision mutations (#986 — Phase A of the finance version-control
 * program). Five verbs over ONE shared counter, `projects.revision`:
 *
 * ```
 *   v1 DRAFT ─ send ─▶ v1 SENT ─ accept ─▶ v1 ACCEPTED ─▶ project may CONFIRM
 *        ▲               │ │ │
 *        └─ recall ──────┘ │ └─ decline ─▶ v1 DECLINED
 *                          └─ new version ─▶ v2 DRAFT  (v1 → SUPERSEDED on v2's send)
 * ```
 *
 * Properties this file exists to guarantee, each with a test in
 * `quotesWrites.test.ts`:
 *
 * - **Exactly one quote row per `(projectId, revision)`** — `by_projectId_version`
 *   is the uniqueness guard.
 * - **At most one `DRAFT`**, always at `projects.revision`.
 * - **At most one live (`SENT`/`ACCEPTED`) row** — the document the client is
 *   currently holding.
 * - **`projects.revision` is monotonic** — never decremented, never reused. A
 *   recalled-then-re-sent revision keeps its number.
 * - **Supersede fires on SEND, not on draft.** v1 stays `SENT` while v2 is a
 *   draft, so cutting a draft never invalidates the client's document. That is
 *   the difference between version control and a delete button.
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
 * `isHardLockOverrideAllowed`** (org admin/owner, or one of the project's
 * `projectManagers`) — un-sending a document the client may already be holding is
 * trust-sensitive in a way the other four verbs are not. No new permission
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
  const lines = await buildFinanceLines(ctx, project.id);
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

  const revision = projectRevision(project);
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
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, organizationId, projectId, quoteDate, validityDays, recipientContactId, notes, auditId, now } = args;
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
      action: "UPDATE",
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
 * revision (the number is never reused or skipped). The stored artifact is marked
 * recalled and RETAINED, never deleted: the client may already be holding it, so
 * destroying our copy would make the record worse, not better.
 *
 * Restores whatever this send superseded back to `SENT` — after recalling v2, the
 * last thing actually sent is v1, and the model must say so.
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

    await ctx.db.patch(quote._id, {
      status: "DRAFT",
      recalledAt: now,
      recalledById: actor.userId,
      recallReason: trimmed,
      updatedAt: now,
    });

    // Un-supersede the revision this one displaced: with v2 recalled, v1 is once
    // again the document the client is holding.
    let restoredQuoteId: string | null = null;
    for (const other of await listProjectQuotes(ctx, organizationId, project.id)) {
      if (other.id === quote.id || other.supersededByQuoteId !== quote.id) continue;
      if (effectiveQuoteStatus(other, now) !== "SUPERSEDED") continue;
      await ctx.db.patch(other._id, { status: "SENT", supersededByQuoteId: undefined, updatedAt: now });
      restoredQuoteId = other.id;
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "UPDATE",
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
 * NEW VERSION — the unlock. Increments `projects.revision` and opens a `DRAFT`
 * quote at the new number. The previous `SENT`/`ACCEPTED` row is deliberately
 * left alone: it stays the client's current document until the new revision is
 * actually sent.
 *
 * Requires the current revision to have been sent (in any terminal state) —
 * cutting v2 while v1 is still a draft would break "at most one DRAFT, always at
 * `projects.revision`". Edit the draft instead.
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
    const current = await findQuoteAtRevision(ctx, organizationId, projectId, revision);
    if (!current || effectiveQuoteStatus(current, now) === "DRAFT") {
      throw new ConvexError({
        code: "QUOTE_DRAFT_OPEN",
        message: `Quote v${revision} hasn't been sent yet — edit that draft instead of creating v${revision + 1}.`,
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

    await ctx.db.patch(project._id, { revision: next, updatedAt: now });
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
      action: "CREATE",
      entityType: "quote",
      entityId: id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Started quote ${label}`,
      details: { version: next, previousVersion: revision },
      projectId,
      createdAt: now,
    });

    return { id, version: next };
  },
});

/**
 * REPRICE FROM REVISION — "Use vN's pricing for v(N+1)" (#989 §8.1), the
 * forward-only equivalent of "Restore" every version-history pattern studied
 * offers and this program deliberately doesn't (rewriting a SENT quote in place
 * would falsify the record of what a client was given — the whole point of
 * Phase B). Composes `newVersionNative`'s "cut the next draft" behaviour with
 * `restoreProjectSnapshot({ scope: "FINANCIAL" })` in ONE transaction, so the
 * new draft is born already priced like an earlier revision instead of a
 * two-step "create then somehow copy the numbers over" dance a user would
 * otherwise have to do by hand.
 *
 * Structure is untouched — same gear, same quantities, same dates.
 * `restoreProjectSnapshot`'s FINANCIAL scope patches ONLY the locked money
 * fields (`LOCKED_PROJECT_FIELDS`/`LOCKED_GROUP_FIELDS`/`LOCKED_LINE_ITEM_FIELDS`)
 * and resets anything added since the source revision to $0/unset rather than
 * deleting it — exactly the same "added while pricing was locked" state
 * `UnpricedBadge` exists for. The confirm dialog states that count and any
 * rental-window drift BEFORE calling this — computed client-side from data the
 * revision viewer already has (the diff against current), not returned here.
 *
 * ONE audit entry for the whole operation, not one per line (the design doc is
 * explicit about this) — `restoreProjectSnapshot`'s per-entity writes are an
 * implementation detail, not N separate user actions.
 */
export const repriceFromRevisionNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), sourceVersion: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    /** The revision whose money fields the new draft is seeded with — any past
     *  revision that was actually sent (has a `snapshotId`), not necessarily the
     *  one immediately prior. */
    sourceQuoteId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, sourceQuoteId, actor: suppliedActor, auditId, now }) => {
    const actor = await guardQuoteWrite(ctx, organizationId, suppliedActor);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_QUOTE", message: "Templates don't have quotes." });
    }
    // Same sanctioned bypass as `newVersionNative` — cutting the next version IS
    // the unlock (decision 2), so gating this against the revision it's about to
    // move past would make the exit unreachable.
    await assertLifecycleGuard(ctx, project, { kind: "financial", bypassQuoteLock: true });

    const sourceQuote = await requireQuoteInOrg(ctx, sourceQuoteId, organizationId);
    if (sourceQuote.projectId !== projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That revision doesn't belong to this project." });
    }
    if (!sourceQuote.snapshotId) {
      throw new ConvexError({
        code: "QUOTE_NO_SNAPSHOT",
        message: `Quote v${sourceQuote.version} has no stored pricing snapshot to reprice from (never sent, or sent before version history).`,
      });
    }

    const revision = projectRevision(project);
    const current = await findQuoteAtRevision(ctx, organizationId, projectId, revision);
    if (!current || effectiveQuoteStatus(current, now) === "DRAFT") {
      throw new ConvexError({
        code: "QUOTE_DRAFT_OPEN",
        message: `Quote v${revision} hasn't been sent yet — edit that draft instead of repricing into a new one.`,
      });
    }

    const next = revision + 1;
    if (await findQuoteAtRevision(ctx, organizationId, projectId, next)) {
      throw new ConvexError({
        code: "QUOTE_VERSION_CONFLICT",
        message: `Quote v${next} already exists for this project.`,
      });
    }
    const dup = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError({ code: "DUPLICATE", message: "Quote already exists" });

    await ctx.db.patch(project._id, { revision: next, updatedAt: now });
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

    // Structure stays exactly as it is now; only the locked money fields move to
    // match the source revision's frozen values.
    const { conflicts } = await restoreProjectSnapshot(ctx, {
      orgId: organizationId,
      project,
      snapshotId: sourceQuote.snapshotId,
      scope: "FINANCIAL",
      now,
    });

    const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    await recalcProjectTotals(ctx, projectId, organizationId, taxRate, now);

    const label = quoteLabel(project.projectNumber, next);
    const sourceLabel = quoteLabel(project.projectNumber, sourceQuote.version);
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "quote",
      entityId: id,
      entityName: label,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Started quote ${label} using ${sourceLabel}'s pricing`,
      details: { version: next, sourceVersion: sourceQuote.version, previousVersion: revision, conflicts },
      projectId,
      createdAt: now,
    });

    return { id, version: next, sourceVersion: sourceQuote.version };
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
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "UPDATE",
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
      action: "UPDATE",
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
  // Cuts a fresh DRAFT at the next revision — the prior SENT/ACCEPTED quote the
  // client is holding is left untouched until that draft is itself sent.
  newVersionNative: { danger: "medium" },
  recallNative: { danger: "high" },
  // Same "opens a new DRAFT, doesn't touch the sent/locked revision" shape as
  // newVersionNative — only its money fields are seeded from a past snapshot.
  repriceFromRevisionNative: { danger: "medium" },
  sendNative: { danger: "high" },
};
