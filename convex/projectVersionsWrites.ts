import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { assertLifecycleGuard, isHardLockOverrideAllowed } from "./lib/projectLocks";
import {
  captureProjectSnapshot,
  findSnapshotForRevision,
  liveStateMatchesCapturedSnapshot,
  restoreProjectSnapshot,
} from "./lib/projectSnapshots";
import { recalcProjectTotals } from "./lib/recalc";
import { resolveOrgDefaultTaxRate } from "./lib/orgSettings";
import { candidateBoardProjects } from "./lib/overbookingBoard";
import { computePromoteOverbookingConflicts } from "./lib/overbookingConfirmImpact";
import { fetchCandidateProjects, fetchGearData } from "./overbookingBoard";
import {
  findQuoteAtRevision,
  projectLiveRevision,
  projectRevision,
  quoteLabel,
  requireProjectInOrg,
} from "./lib/quoteState";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Project version mutations (#1080/#1085, Phase 1 of the project-version-
 * switching program). Introduces the model this program is built on —
 * `projects.liveRevision` — without any restore/promote machinery yet
 * (Phase 2, `promoteRevisionNative`) and without any UI (Phase 3/4). The
 * existing five quote verbs in `convex/quotesWrites.ts` are untouched except
 * for `newVersionNative`, which gains the same "capture before moving past"
 * step this file introduces.
 *
 * **The invariant change this file causes.** Before this phase: "at most one
 * `DRAFT` quote per project, always at `projects.revision`." After: "at most
 * one **live** `DRAFT` quote, always at `projects.liveRevision`." Calling
 * `saveVersionNative` while the current live revision is itself a never-sent
 * `DRAFT` deliberately leaves that row behind, unsent and now non-live — a
 * legitimate saved-but-never-sent version, not a bug. Anything that scans the
 * whole project for "the draft" without scoping to `liveRevision` will
 * mis-target that orphaned row; `deleteDraftNative`
 * (`convex/quotesWrites.ts`) is guarded against exactly this.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Mirrors `quoteSaveVersionSchema`'s bound in `src/lib/validations/quote.ts` —
 *  the client Zod parse is UX only and bypassable by any caller with a valid
 *  session hitting the mutation directly (FEATUREDOCS/54). */
const LABEL_BOUNDS = { max: 60 } as const;

/**
 * SAVE VERSION — freeze a copy of the current live revision and carry on
 * editing at a fresh number. Unlike `newVersionNative`, reachable from ANY
 * live-revision state, including a never-sent `DRAFT` — this is the
 * mid-draft checkpoint ("save this as 'with LED wall', try something else")
 * `newVersionNative` can't offer, since that mutation refuses to run unless
 * the current revision has already been sent.
 *
 * 1. Capture the live state as a snapshot attached to the CURRENT live
 *    revision (`reason: "VERSION_SAVED"`, carrying that revision number).
 * 2. If a quote row already exists at that revision (draft or sent), point
 *    its `snapshotId` at the fresh capture — `quotes.snapshotId` is no longer
 *    written only by `sendNative`.
 * 3. Allocate `next = projects.revision + 1`; set `revision = next` AND
 *    `liveRevision = next` together (Phase 1 never decouples them — only a
 *    Phase 2 promote can point `liveRevision` at an older number).
 * 4. Insert a fresh `DRAFT` quote at `next` with `snapshot: null` — a draft
 *    carries no money snapshot; its figures are the project's live totals
 *    until it is itself sent (unchanged from `newVersionNative`).
 *
 * The live tables are never touched — saving a version freezes a copy of
 * where you are and carries on; it is not a checkpoint you must restore from.
 */
export const saveVersionNative = mutation({
  returns: v.object({ id: v.string(), version: v.number(), savedRevision: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    /** Optional internal name for the version being saved ("with LED wall").
     *  Never affects behaviour or numbering — see `quotes.label` in the schema. */
    label: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, label, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "quote");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "invoice", "publish");
    const actor = await resolveActor(ctx, suppliedActor);

    const trimmedLabel = label?.trim() || undefined;
    assertStrLen(trimmedLabel, "label", LABEL_BOUNDS);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_QUOTE", message: "Templates don't have quotes." });
    }
    // Same sanctioned bypass `newVersionNative`/`repriceFromRevisionNative` use
    // — saving a version IS a way off a quote-derived lock (it moves the live
    // revision forward), so gating this against the revision it's about to
    // move past would make the exit unreachable. STATUS-driven tiers
    // (CONFIRMED+/ON_SITE+/COMPLETED+) still gate normally.
    await assertLifecycleGuard(ctx, project, { kind: "financial", bypassQuoteLock: true });

    const revision = projectRevision(project);
    const liveRevision = projectLiveRevision(project);
    const next = revision + 1;
    // Monotonicity belt-and-braces, same shape as `newVersionNative` — a row
    // already sitting at the next number would mean `projects.revision` had
    // drifted backwards. Never overwrite it.
    if (await findQuoteAtRevision(ctx, organizationId, projectId, next)) {
      throw new ConvexError({
        code: "QUOTE_VERSION_CONFLICT",
        message: `Quote v${next} already exists for this project.`,
      });
    }
    // `by_cuid` is global and non-unique — dup-guard the client-minted id.
    const dup = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError({ code: "DUPLICATE", message: "Quote already exists" });

    // The quote row at the OUTGOING live revision, if one exists — a fresh
    // project that has never been quoted has none yet, and that's fine:
    // there's simply nothing to point at the new capture.
    const outgoing = await findQuoteAtRevision(ctx, organizationId, projectId, liveRevision);

    const snapshotId = await captureProjectSnapshot(ctx, {
      orgId: organizationId,
      project,
      reason: "VERSION_SAVED",
      revision: liveRevision,
      actor,
      now,
    });
    if (outgoing) {
      await ctx.db.patch(outgoing._id, { snapshotId, updatedAt: now });
    }

    // Saving a version does NOT touch the live tables — see the file header.
    await ctx.db.patch(project._id, { revision: next, liveRevision: next, updatedAt: now });
    await ctx.db.insert("quotes", {
      id,
      organizationId,
      projectId,
      version: next,
      status: "DRAFT",
      snapshot: null,
      label: trimmedLabel,
      createdById: actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    const savedLabel = quoteLabel(project.projectNumber, liveRevision);
    const newLabel = quoteLabel(project.projectNumber, next);
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "QUOTE_VERSION_SAVED",
      entityType: "quote",
      entityId: id,
      entityName: newLabel,
      userId: actor.userId,
      userName: actor.userName,
      summary: trimmedLabel
        ? `Saved ${savedLabel} as "${trimmedLabel}", continuing as ${newLabel}`
        : `Saved ${savedLabel}, continuing as ${newLabel}`,
      details: {
        savedRevision: liveRevision,
        savedSnapshotId: snapshotId,
        version: next,
        label: trimmedLabel ?? null,
      },
      projectId,
      createdAt: now,
    });

    return { id, version: next, savedRevision: liveRevision };
  },
});

/** Preconditions 1-5, checked IN THIS ORDER (R-3.6, the `assertRecalledDeletable`
 *  precedent — a caller fixing one rejection at a time should see the real one
 *  first). Split out of the handler so the write path reads as a straight line
 *  (same reasoning as `quotesWrites.ts`'s `prepareSend`). */
async function assertPromotePreconditions(
  ctx: MutationCtx,
  project: Doc<"projects">,
  organizationId: string,
  projectId: string,
  targetRevision: number,
  userId: string,
): Promise<{ liveRevision: number; targetSnapshot: Doc<"projectSnapshots"> }> {
  // 1. Not a template.
  if (project.isTemplate) {
    throw new ConvexError({ code: "TEMPLATE_NO_VERSIONS", message: "Templates don't have versions to promote." });
  }

  // 2. Target isn't already live, and has captured state to restore from.
  const liveRevision = projectLiveRevision(project);
  if (targetRevision === liveRevision) {
    throw new ConvexError({ code: "VERSION_NOT_RESTORABLE", message: `v${targetRevision} is already live.` });
  }
  const targetSnapshot = await findSnapshotForRevision(ctx, organizationId, projectId, targetRevision);
  if (!targetSnapshot) {
    throw new ConvexError({
      code: "VERSION_NOT_RESTORABLE",
      message: `v${targetRevision} has no captured state to restore from.`,
    });
  }

  // 3. RBAC — org admin/owner, or one of the project's assigned PM(s).
  if (!(await isHardLockOverrideAllowed(ctx, organizationId, projectId, userId))) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Only org admins/owners or this project's assigned PM(s) can promote a version.",
    });
  }

  // 4. Lifecycle lock — a locked project needs an open FULL-scope unlock
  // session; no separate justification argument on THIS mutation (decision 17).
  await assertLifecycleGuard(ctx, project, { kind: "structural" });

  // 5. No non-VOID ISSUED invoice on the project.
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", organizationId).eq("projectId", projectId))
    .collect();
  if (invoices.some((inv) => inv.status === "ISSUED")) {
    throw new ConvexError({
      code: "PROMOTE_BLOCKED_INVOICED",
      message: "An invoice has already been issued on this project — void it or issue a credit before promoting a different version.",
    });
  }

  return { liveRevision, targetSnapshot };
}

interface AutoCaptureArgs {
  organizationId: string;
  projectId: string;
  project: Doc<"projects">;
  liveRevision: number;
  targetRevision: number;
  actor: { userId: string; userName: string };
  now: number;
}

/** Auto-capture the outgoing live state before `restoreProjectSnapshot`
 *  overwrites it (design §3.4 step 1) — the three branches described in
 *  `promoteRevisionNative`'s own docstring. Split out for the same reason as
 *  `assertPromotePreconditions` above (R-3.6). */
async function autoCaptureOutgoingRevision(
  ctx: MutationCtx,
  args: AutoCaptureArgs,
): Promise<{ nextAllocator: number; autoSavedRevision?: number }> {
  const { organizationId, projectId, project, liveRevision, targetRevision, actor, now } = args;
  const revision = projectRevision(project);
  const liveSnapshot = await findSnapshotForRevision(ctx, organizationId, projectId, liveRevision);

  if (!liveSnapshot) {
    // Branch 1: never captured (a working draft) — capture onto the live
    // revision itself, no new number allocated.
    const snapshotId = await captureProjectSnapshot(ctx, {
      orgId: organizationId, project, reason: "PRE_PROMOTE", revision: liveRevision, actor, now,
    });
    const liveQuote = await findQuoteAtRevision(ctx, organizationId, projectId, liveRevision);
    if (liveQuote) await ctx.db.patch(liveQuote._id, { snapshotId, updatedAt: now });
    return { nextAllocator: revision };
  }

  const identical = await liveStateMatchesCapturedSnapshot(ctx, organizationId, project, liveSnapshot.id);
  if (identical) return { nextAllocator: revision }; // Branch 3: nothing at risk — skipped.

  // Branch 2: already captured (e.g. sent) and has drifted since — that
  // capture is frozen evidence and must not be conflated with a fresh one.
  // Allocate M = revision + 1, capture the current live state there, and
  // open a labelled DRAFT so it has somewhere to live in the version list.
  const m = revision + 1;
  if (await findQuoteAtRevision(ctx, organizationId, projectId, m)) {
    throw new ConvexError({ code: "QUOTE_VERSION_CONFLICT", message: `Quote v${m} already exists for this project.` });
  }
  const snapshotId = await captureProjectSnapshot(ctx, {
    orgId: organizationId, project, reason: "PRE_PROMOTE", revision: m, actor, now,
  });
  await ctx.db.insert("quotes", {
    id: createId(),
    organizationId,
    projectId,
    version: m,
    status: "DRAFT",
    snapshot: null,
    snapshotId,
    label: `Auto-saved before switching to v${targetRevision}`,
    createdById: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  return { nextAllocator: m, autoSavedRevision: m };
}

/** Rolling the rental window reaches outside this project (design §5.2) —
 *  re-derive availability for `projectId`'s own gear and report any resulting
 *  overbooking, using the existing board aggregation (`overbookingBoard.ts`)
 *  rather than a new check. A no-op when the promote didn't move either date. */
async function deriveDateMoveConflicts(
  ctx: MutationCtx,
  organizationId: string,
  projectId: string,
  before: Pick<Doc<"projects">, "rentalStartDate" | "rentalEndDate">,
  after: Doc<"projects">,
): Promise<string[]> {
  const datesMoved = after.rentalStartDate !== before.rentalStartDate || after.rentalEndDate !== before.rentalEndDate;
  if (!datesMoved || after.rentalStartDate == null || after.rentalEndDate == null) return [];

  const window = { start: after.rentalStartDate, end: after.rentalEndDate };
  const projectDocsById = await fetchCandidateProjects(ctx, organizationId, window.end);
  projectDocsById.set(after.id, after);
  const candidateProjects = candidateBoardProjects([...projectDocsById.values()], window);
  const candidateProjectIds = candidateProjects.map((p) => p.id);
  const { lineItems, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, organizationId, candidateProjectIds);
  const overbookingRows = computePromoteOverbookingConflicts(
    projectId, window, candidateProjects, lineItems, models, assets, bulkAssetsForModels,
  );
  return overbookingRows.map(
    (row) => `Moving the rental window created a shortage of ${row.qty} × ${row.modelName} (also booked on ${row.projectNumbers.join(", ")}).`,
  );
}

/**
 * PROMOTE — make an older (or newer, non-live) version live (#1080/#1089,
 * Phase 2). Third caller of `restoreProjectSnapshot` (design §3.4), a
 * `scope: "PROMOTE"` restore (`projectSnapshots.ts` §3.5) plus the
 * preconditions, the auto-capture rule and the availability re-derive that
 * make it safe. **No UI in this phase** — the promote dialog is Phase 4; this
 * mutation is exercised through tests.
 *
 * Five preconditions (`assertPromotePreconditions`): not a template → target
 * isn't already live and has a captured snapshot → caller is
 * `isHardLockOverrideAllowed` → the lifecycle lock (a locked project needs an
 * open FULL-scope unlock session — no separate justification argument here,
 * decision 17) → no non-VOID ISSUED invoice.
 *
 * Then, in one transaction: auto-capture the live state
 * (`autoCaptureOutgoingRevision` — skipped if it's already snapshotted AND
 * byte-identical to that snapshot, since nothing is at risk),
 * `restoreProjectSnapshot({ scope: "PROMOTE" })`, move `liveRevision` (never
 * `revision`, which stays the high-water mark), recalc totals, re-derive
 * availability if the rental window moved (`deriveDateMoveConflicts`), audit.
 */
export const promoteRevisionNative = mutation({
  returns: v.object({
    conflicts: v.array(v.string()),
    autoSavedRevision: v.optional(v.number()),
    liveRevision: v.number(),
  }),
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    targetRevision: v.number(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, projectId, targetRevision, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);

    const { liveRevision, targetSnapshot } = await assertPromotePreconditions(
      ctx, project, organizationId, projectId, targetRevision, actor.userId,
    );

    const { nextAllocator, autoSavedRevision } = await autoCaptureOutgoingRevision(ctx, {
      organizationId, projectId, project, liveRevision, targetRevision, actor, now,
    });

    // ── Restore the target's captured state onto the live tables ──
    const { conflicts } = await restoreProjectSnapshot(ctx, {
      orgId: organizationId,
      project,
      snapshotId: targetSnapshot.id,
      scope: "PROMOTE",
      now,
    });

    await ctx.db.patch(project._id, { revision: nextAllocator, liveRevision: targetRevision, updatedAt: now });

    const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
    await recalcProjectTotals(ctx, projectId, organizationId, taxRate, now);

    const restoredProject = await requireProjectInOrg(ctx, projectId, organizationId);
    conflicts.push(...(await deriveDateMoveConflicts(ctx, organizationId, projectId, project, restoredProject)));

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "PROJECT_VERSION_PROMOTED",
      entityType: "project",
      entityId: projectId,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary:
        `Promoted v${targetRevision} to live (was v${liveRevision})` +
        (autoSavedRevision ? `, auto-saved the outgoing state as v${autoSavedRevision}` : "") +
        (conflicts.length > 0 ? ` — ${conflicts.length} item(s) need manual review` : ""),
      details: { fromRevision: liveRevision, toRevision: targetRevision, autoSavedRevision: autoSavedRevision ?? null, conflicts },
      projectId,
      createdAt: now,
    });

    return { conflicts, autoSavedRevision, liveRevision: targetRevision };
  },
});

/** The client-supplied field set, exported for the Zod↔Convex parity test
 *  (`convex/validationDrift.test.ts`, R-8.6.1) — pairs with
 *  `quoteSaveVersionSchema` in `src/lib/validations/quote.ts`. No monetary
 *  amount appears here (R-9.3) — same rule every quote-verb field set follows. */
export const quoteSaveVersionFields = {
  label: v.optional(v.string()),
};

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9). */
export const agentOps: AgentOpsAnnotations = {
  // Freezes a copy of the current live state and moves live editing to a
  // fresh DRAFT at the next number — the live tables aren't touched, and
  // whatever the outgoing revision's own status was (draft or sent) is left
  // exactly as it was. Same risk class as newVersionNative/
  // repriceFromRevisionNative: low.
  saveVersionNative: { danger: "low" },
  // Rewrites live project state (equipment, dates, client, notes) from an
  // older or newer captured version — CLAUDE.md's high rubric ("stock-
  // affecting, irreversible-feeling, lock-softening") applies directly; the
  // API dispatcher requires confirm:true before this reaches Convex at all.
  promoteRevisionNative: { danger: "high" },
};
