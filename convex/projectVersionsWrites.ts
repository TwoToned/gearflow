import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, requireService, resolveActor } from "./lib/auth";
import { versionRows, type VersionedTableName } from "./lib/versionScope";
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
import { getProjectWindow } from "./lib/projectWindow";
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
 *  session hitting the mutation directly (FEATUREDOCS/54). Exported so
 *  `quotesWrites.setQuoteLabelNative` (#1097 — editing a label after the fact,
 *  not just at save time) shares the one bound rather than duplicating it
 *  (R-3.1). */
export const LABEL_BOUNDS = { max: 60 } as const;

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
  before: Pick<Doc<"projects">, "rentalStartDate" | "rentalEndDate" | "projectStartDate" | "projectEndDate">,
  after: Doc<"projects">,
): Promise<string[]> {
  // Compare the RESOLVED (gear-committed) window, not raw rental dates — see
  // project-window.ts. A promote that only moves projectStartDate/projectEndDate
  // (no rental change) still needs this re-derive.
  const beforeWindow = getProjectWindow(before);
  const afterWindow = getProjectWindow(after);
  const windowMoved = afterWindow.start !== beforeWindow.start || afterWindow.end !== beforeWindow.end;
  if (!windowMoved || afterWindow.start == null || afterWindow.end == null) return [];

  const window = { start: afterWindow.start, end: afterWindow.end };
  const projectDocsById = await fetchCandidateProjects(ctx, organizationId, window.end);
  projectDocsById.set(after.id, after);
  const candidateProjects = candidateBoardProjects([...projectDocsById.values()], window);
  const candidateProjectIds = candidateProjects.map((p) => p.id);
  const { lineItems, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, organizationId, candidateProjectIds, projectDocsById);
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

// ────────────────────────────────────────────────────────────────────────────
// §6 step 2 MATERIALIZATION (#1228, Phase 2 of "Project versioning v2") —
// distinct from everything above this line. Everything above
// (saveVersionNative/promoteRevisionNative/`projectSnapshots`/`revision`/
// `liveRevision`) is the OLDER "Project Version Switcher" program
// (FEATUREDOCS/70) — a JSON-blob snapshot/restore mechanism. This is the
// NEW `projectVersions` table's own row-level mechanism (FEATUREDOCS/76):
// giving a non-live `projectVersions` row REAL, individually-queryable
// `by_versionId`-tagged plan rows of its own, rather than a JSON blob.
//
// Internal/minimal by design — no UI calls this yet (SERVICE-only guard).
// It exists so a later phase (the one that starts WRITING non-live versions
// via "save a version") has a proven-safe primitive to build on, rather than
// inventing row-cloning semantics under deadline at that point.
//
// ── DEPLOY-ORDER CONSTRAINT (read before wiring this up to anything) ──────
// This mutation reads and writes EXCLUSIVELY through the `by_versionId`
// index family (`versionRows`, `convex/lib/versionScope.ts`) — it has no
// `by_projectId` fallback of any kind. It is therefore only correct to CALL
// (not just deploy — call) once:
//   1. Phase 1's backfill (`convex/backfillProjectVersions.ts`) has actually
//      run against the target deployment, so every existing project has a
//      `liveVersionId` and every existing row has a `versionId`; AND
//   2. The Phase 2 schema (this same commit: `by_projectId` deleted,
//      `by_versionId` added on the 4 plan tables) is the live schema.
// Both conditions hold by construction for THIS codebase the moment it's
// deployed (the backfill predates this phase per CLAUDE.md/the file-level
// comment on `versionScope.ts`, and this mutation ships in the same commit
// as the index rename) — but they are NOT independently re-verified at
// call time beyond the ordinary `requireLiveVersionId` throw every other
// Phase 2 read/write already gets. **This ordering has been validated only
// against convex-test fixtures in this sandbox, never against a real Convex
// deployment** (no live deployment was available to this session) — the
// first real call against production should be treated as the actual proof,
// not this test suite alone.
//
// SAFETY properties this mutation enforces (all mechanically checked, not
// just documented):
//   - Never targets the project's OWN live version (its rows already exist
//     by definition — materializing over them would duplicate every lineage).
//   - Refuses to run if the target version ALREADY has any rows in any of
//     the 4 tables (no accidental double-materialize / silent duplication;
//     unlike CLAUDE.md's `createIfMissing` convention for a single mirrored
//     row, a multi-row clone has no natural idempotent merge, so this is an
//     explicit check-then-refuse rather than an upsert).
//   - Every cloned row gets a FRESH `id` but keeps the SOURCE row's
//     `lineageId` (falling back to the source row's own `id` if it predates
//     lineage tagging) — the same "a duplicate starts its own physical row
//     but keeps the logical thread" rule `projectWrites.ts`'s
//     `duplicateNative` uses for `versionId`, mirrored here for `lineageId`
//     instead (a *duplicate* project wants a fresh lineage per row; THIS
//     materialize is cloning the SAME project's plan into a sibling
//     version, so the whole point is to let `by_versionId_lineageId` find
//     "this same line across versions" — the opposite choice, deliberately).
//   - Org- and project-checked on every `by_cuid`-resolved id it touches
//     (`by_cuid` is global — R-8.4.3), same discipline as every other write
//     in this codebase.
export const VERSIONED_PLAN_TABLES: readonly VersionedTableName[] = [
  "projectCategories",
  "projectGroups",
  "projectLineItems",
  "projectServices",
];

/** Validates the request and resolves `{project, targetVersion, sourceId}` —
 *  split out of the mutation body purely to keep the handler itself under
 *  the max-lines-per-function ratchet (R-3.6), same rationale as
 *  `assertPromotePreconditions` above. Every throw here mirrors the handler
 *  doc's own error message text 1:1 — nothing behavioural moved, only the
 *  lines. */
async function resolveMaterializeTargets(
  ctx: MutationCtx,
  args: { organizationId: string; projectId: string; targetVersionId: string; sourceVersionId?: string },
): Promise<{ project: Doc<"projects">; targetVersion: Doc<"projectVersions">; sourceId: string }> {
  const { organizationId, projectId, targetVersionId, sourceVersionId } = args;

  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== organizationId) {
    throw new ConvexError(`materializeVersionRowsNative: project not found or cross-org: ${projectId}`);
  }

  const targetVersion = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", targetVersionId)).first();
  if (!targetVersion || targetVersion.organizationId !== organizationId || targetVersion.projectId !== projectId) {
    throw new ConvexError(`materializeVersionRowsNative: target version not found or cross-org/project: ${targetVersionId}`);
  }
  if (targetVersionId === project.liveVersionId) {
    throw new ConvexError("materializeVersionRowsNative: refusing to materialize the LIVE version — its rows already exist by definition.");
  }

  // Idempotency / duplication guard — see the file-level comment above.
  const existingByTable = await Promise.all(VERSIONED_PLAN_TABLES.map((t) => versionRows(ctx, t, targetVersionId)));
  if (existingByTable.some((rows) => rows.length > 0)) {
    throw new ConvexError(
      `materializeVersionRowsNative: version ${targetVersionId} already has plan rows — refusing to double-materialize.`,
    );
  }

  const sourceId = sourceVersionId ?? project.liveVersionId;
  if (!sourceId) {
    throw new ConvexError(
      "materializeVersionRowsNative: project has no liveVersionId to materialize from — Phase 1's backfill must run first (#1228).",
    );
  }
  if (sourceId !== project.liveVersionId) {
    const sourceVersion = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", sourceId)).first();
    if (!sourceVersion || sourceVersion.organizationId !== organizationId || sourceVersion.projectId !== projectId) {
      throw new ConvexError(`materializeVersionRowsNative: source version not found or cross-org/project: ${sourceId}`);
    }
  }

  return { project, targetVersion, sourceId };
}

export const materializeVersionRowsNative = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    /** The (non-live) version to populate with real rows. */
    targetVersionId: v.string(),
    /** Clone FROM this version's rows. Defaults to the project's current
     *  live version — the common case ("branch a new version off what's
     *  live right now"). */
    sourceVersionId: v.optional(v.string()),
  },
  handler: async (ctx: MutationCtx, { organizationId, projectId, targetVersionId, sourceVersionId }) => {
    await requireService(ctx);

    const { targetVersion, sourceId } = await resolveMaterializeTargets(ctx, {
      organizationId, projectId, targetVersionId, sourceVersionId,
    });

    // Two passes, because a clone must not leave a child pointing at a
    // parent id that only exists in the SOURCE version. Every row gets a
    // fresh `id` (pass 1), so `categoryId`/`groupId`/`parentLineItemId` —
    // in-clone-set foreign keys that name another row of these same 4
    // tables by its `id` — have to be rewritten through the old-id -> new-id
    // map (pass 2) or a materialized line item would reference a group/
    // category/parent that doesn't exist in its own version. FK fields that
    // point OUTSIDE this clone set (modelId/assetId/kitId/subHireId/
    // crewRoleId/…) are untouched — those name a different table's row
    // entirely and aren't per-version.
    type SourceRow = Record<string, unknown> & {
      _id: unknown; _creationTime: unknown; id: string; versionId?: string; lineageId?: string;
    };
    const IN_CLONE_SET_FK_FIELDS = ["categoryId", "groupId", "parentLineItemId"] as const;

    const idMap = new Map<string, string>(); // old row id -> new (materialized) row id
    const toInsert: { table: VersionedTableName; doc: Record<string, unknown> }[] = [];

    for (const table of VERSIONED_PLAN_TABLES) {
      const rows = await versionRows(ctx, table, sourceId);
      for (const row of rows) {
        const source = row as unknown as SourceRow;
        const { _id, _creationTime, id, versionId, lineageId, ...rest } = source;
        void _id;
        void _creationTime;
        void versionId;
        const newId = createId();
        idMap.set(id, newId);
        toInsert.push({
          table,
          doc: { ...rest, id: newId, versionId: targetVersionId, lineageId: lineageId ?? id },
        });
      }
    }

    let materialized = 0;
    for (const { table, doc } of toInsert) {
      for (const fk of IN_CLONE_SET_FK_FIELDS) {
        const oldRef = doc[fk];
        if (typeof oldRef === "string" && idMap.has(oldRef)) doc[fk] = idMap.get(oldRef);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table name is a loop variable over the 4 known versioned tables
      await ctx.db.insert(table as any, doc);
      materialized += 1;
    }

    // NOTE: `categorySlots` (ordering within a category/group) is NOT cloned
    // here — it has no `versionId` of its own (schema.ts's PARENT_JOIN
    // comment) and would need its own oldId->newId FK rewrite
    // (`projectCategoryId`/`projectGroupId`/`lineItemId`) plus per-row
    // `subHireGroupId`/`lineItemId` handling this internal-only, no-UI
    // primitive doesn't yet need. A materialized version is therefore
    // correct on MEMBERSHIP (every category/group/line/service exists, with
    // valid in-version parent/group/category FKs) but starts with NO
    // recorded slot order — callers that need slot ordering on a
    // materialized non-live version must extend this before relying on it.
    await ctx.db.patch(targetVersion._id, { contentState: "ready" });
    return { materialized };
  },
});

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
