import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { requireProjectInOrg } from "./lib/quoteState";
import { requireLiveVersionId } from "./lib/versionScope";
import { listProjectVersions } from "./lib/projectVersionState";
import { copyPlanGraph, VERSIONED_PLAN_TABLES, MAX_CLONABLE_PLAN_ROWS } from "./lib/versionGraph";
import { versionRows } from "./lib/versionScope";
import { pickPlanFields } from "./lib/versionPlanFields";
import { loadVersionInOrgProject, performMakeLive } from "./lib/makeLiveCore";
import { LABEL_BOUNDS } from "./projectVersionsWrites";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ THE VERSION x QUOTE STATE MACHINE (#1233, Phase 6, parent #1221)           │
 * │ ────────────────────────────────────────────────────────────────────────  │
 * │ Two independent state machines, joined only by `quotes.versionId`:        │
 * │                                                                            │
 * │  projectVersions       ready, exactly one is `projects.liveVersionId`     │
 * │  (this file)           at any time — createNative/makeLiveNative/         │
 * │                        setLabelNative/deleteNative, no quote awareness.   │
 * │                                                                            │
 * │  quotes                DRAFT ─ send ─▶ SENT ─┬─ accept ─▶ ACCEPTED        │
 * │  (quotesWrites.ts)                    ▲      ├─ decline ─▶ DECLINED       │
 * │                                        └recall┘                          │
 * │                        (EXPIRED is derived on read, never stored)         │
 * │                                                                            │
 * │ EVERY `projectVersions` row may hold AT MOST ONE `quotes` row addressed   │
 * │ by `(projectId, versionId)` (`by_projectId_versionId`) — the live         │
 * │ version's OLDER revision-number lineage is the one exception, see below.  │
 * │                                                                            │
 * │  ┌──────────┐  sendNative({versionId:A})   ┌──────────┐                  │
 * │  │ Version A│ ─────────────────────────────▶│ SENT (A) │                 │
 * │  │(non-live)│                                └────┬─────┘                │
 * │  └──────────┘                                     │ accept               │
 * │                                                    ▼                     │
 * │  ┌──────────┐  sendNative({versionId:B})   ┌──────────┐  makeLiveNative  │
 * │  │ Version B│ ─────────────────────────────▶│ SENT (B) │  (B) — D20:     │
 * │  │  (live)  │                                └──────────┘  accept COMPOSES│
 * │  └──────────┘                                              make-live, NOT│
 * │                                                              the other way│
 * │ D19 — sending A and B are INDEPENDENT: SENT(A) and SENT(B) coexist,       │
 * │ neither supersedes the other (cross-version supersede REMOVED — the      │
 * │ pre-#1229 un-supersede-on-recall branch this echoes was already gone,    │
 * │ verified, not reintroduced). "Quote two options" IS this diagram.        │
 * │                                                                            │
 * │ D20 — accepting ANY version's SENT quote:                                │
 * │   1. if that version isn't live: performMakeLive(...) flips the pointer  │
 * │      (`convex/lib/makeLiveCore.ts` — the SAME code `makeLiveNative` runs, │
 * │      not a second implementation, R-3.1)                                 │
 * │   2. quote -> ACCEPTED                                                   │
 * │   3. EVERY OTHER open (SENT/EXPIRED) quote on the project, ACROSS EVERY   │
 * │      version -> SUPERSEDED. At most one ACCEPTED per project, always.    │
 * │                                                                            │
 * │ D55/D56 — `pricingLocked` (on `projects`, LIVE version only) is raised by │
 * │ sendNative and cleared by recallNative ONLY when the version being sent/  │
 * │ recalled IS `project.liveVersionId` at that moment — quoting a           │
 * │ speculative non-live option never freezes/unfreezes the live job's       │
 * │ pricing. `quoteTargetsLiveVersion` (`convex/lib/quoteState.ts`) is the    │
 * │ one check both sites use.                                                │
 * │                                                                            │
 * │ Re-send (recall -> send again) REUSES the same `quotes` row — status back │
 * │ to SENT, the old PDF pushed onto `recalledPdfFileIds`, nothing            │
 * │ superseded (#1027's existing recall/resend shape, unchanged by #1233).   │
 * │                                                                            │
 * │ The live version's OLDER revision-number lineage (`newVersionNative`,    │
 * │ untouched by #1233): v1 SENT, "new version" opens v2 DRAFT — sending v2   │
 * │ (still targeting the SAME live `projectVersions` row) supersedes v1, the  │
 * │ one supersede-on-send case #1233 KEEPS (same-version, newer revision) —   │
 * │ scoped by `targetVersionId` equality in `supersedeLiveQuotes`, not        │
 * │ removed outright.                                                        │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/**
 * The real `projectVersions`-table verb set (#1229, Phase 3 of "Project
 * versioning v2", parent #1221). Collapses THREE overlapping "create a
 * version" mutations from the older, `projects.revision`/`liveRevision` +
 * `projectSnapshots` JSON-blob program (`convex/projectVersionsWrites.ts` /
 * `convex/quotesWrites.ts`) into ONE (`createNative`), and replaces
 * promote-as-restore with a pointer flip (`makeLiveNative`) — nothing is
 * overwritten, so no auto-capture is needed, and no dialog-blocking on
 * invoice state either (D6). See FEATUREDOCS/76's Phase 3 section for the
 * full writeup, and CLAUDE.md's "Deleted mutations" note for what this
 * superseded.
 *
 * Every mutation here takes the standard 4-guard browser-direct shape
 * (FEATUREDOCS/54): `assertWritesEnabled`, `enforceBrowserWriteLimit`,
 * `requireOrgPermission`, `resolveActor` — plus org-checked reference loads
 * (`by_cuid` is a GLOBAL index, R-8.4.3) and `writeActivityLog`.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * NEW VERSION (§4.4) — replaces `newVersionNative`/`saveVersionNative`/
 * `repriceFromRevisionNative`. Copies `fromVersionId`'s plan graph
 * (`copyPlanGraph`) into a fresh, non-live `projectVersions` row — the live
 * tables/pointer are never touched, so this is always safe to call, from any
 * state, any number of times. Defaults `fromVersionId` to the project's
 * current live version ("the version you're looking at").
 */
export const createNative = mutation({
  returns: v.object({ id: v.string(), number: v.number(), projectId: v.string() }),
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    fromVersionId: v.optional(v.string()),
    label: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, projectId, fromVersionId, label, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const trimmedLabel = label?.trim() || undefined;
    assertStrLen(trimmedLabel, "label", LABEL_BOUNDS);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_NO_VERSIONS", message: "Templates don't have versions." });
    }

    const sourceVersionId = fromVersionId ?? requireLiveVersionId(project);
    const sourceVersion = await loadVersionInOrgProject(ctx, sourceVersionId, organizationId, projectId, "createNative");
    if (sourceVersion.contentState !== "ready") {
      throw new ConvexError({
        code: "VERSION_NOT_READY",
        message: `Version ${sourceVersion.number} has no captured content to copy from.`,
      });
    }

    const existingVersions = await listProjectVersions(ctx, organizationId, projectId);
    const nextNumber = existingVersions.reduce((max, ver) => Math.max(max, ver.number), 0) + 1;
    const isSourceLive = sourceVersionId === project.liveVersionId;
    // A live source's plan lives on `projects` itself; a non-live source
    // already carries its own PLAN FIELDS row — see schema.ts's comment on
    // `projectVersions`.
    const planFields = pickPlanFields(isSourceLive ? project : sourceVersion);

    const versionId = createId();
    await ctx.db.insert("projectVersions", {
      id: versionId,
      organizationId,
      projectId,
      number: nextNumber,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
      basedOnVersionId: sourceVersionId,
      createdAt: now,
      createdById: actor.userId,
      contentState: "ready",
      ...planFields,
    });

    const { materialized } = await copyPlanGraph(ctx, { sourceVersionId, targetVersionId: versionId });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "PROJECT_VERSION_CREATED",
      entityType: "project",
      entityId: projectId,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: trimmedLabel
        ? `Created v${nextNumber} ("${trimmedLabel}") from v${sourceVersion.number}`
        : `Created v${nextNumber} from v${sourceVersion.number}`,
      details: { fromVersionId: sourceVersionId, fromNumber: sourceVersion.number, toVersionId: versionId, toNumber: nextNumber, materialized },
      projectId,
      createdAt: now,
    });

    return { id: versionId, number: nextNumber, projectId };
  },
});

/**
 * MAKE LIVE (§4.4/§4.8) — replaces `promoteRevisionNative`. A POINTER FLIP,
 * not a restore: nothing is overwritten, so there is no auto-capture step
 * and no `PROMOTE_BLOCKED_INVOICED` gate (D6 — the invoiced total is left
 * for a future dialog to show; the balance invoice is computed from
 * whatever is live when it's issued). NOT blocked by a lifecycle lock
 * either (D37/D39) — a pointer flip destroys nothing, so there is nothing
 * for a lock to protect.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ makeLiveNative({ versionId: K })   // K ≠ liveVersionId,             │
 * │                                    // K.contentState === "ready"     │
 * │                                                                      │
 * │  1. permission check (project:update) — NO lock gate                │
 * │                                                                      │
 * │  2-6. performMakeLive (convex/lib/makeLiveCore.ts) — outgoing/       │
 * │       incoming resolution, carryRealityByLineage, plan-field swap,   │
 * │       liveVersionId flip, recalc + date-move conflict re-check.      │
 * │       #1233 (Phase 6): the SAME steps `markAcceptedNative` runs when │
 * │       accepting a non-live version's quote (D20) — extracted here so │
 * │       there is exactly one implementation (R-3.1), not two.          │
 * └─────────────────────────────────────────────────────────────────────┘
 */
export const makeLiveNative = mutation({
  returns: v.object({
    liveVersionId: v.string(),
    previousLiveVersionId: v.string(),
    conflicts: v.array(v.string()),
    unplannedLineItemIds: v.array(v.string()),
  }),
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    versionId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, projectId, versionId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    // Step 1 — permission only. Deliberately no `assertLifecycleGuard` call
    // anywhere in this mutation (D37/D39): see the file comment above.
    await requireOrgPermission(ctx, organizationId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);
    if (project.isTemplate) {
      throw new ConvexError({ code: "TEMPLATE_NO_VERSIONS", message: "Templates don't have versions to make live." });
    }

    const result = await performMakeLive(ctx, { organizationId, projectId, project, versionId, actor, auditId, now });
    return {
      liveVersionId: result.liveVersionId,
      previousLiveVersionId: result.previousLiveVersionId,
      conflicts: result.conflicts,
      unplannedLineItemIds: result.unplannedLineItemIds,
    };
  },
});

/**
 * RENAME (§4.4) — `versions.setLabelNative`. Reachable on any version, live
 * or not — metadata only, same reasoning as the deleted `saveVersionNative`'s
 * create-time label and the surviving `quotesWrites.setQuoteLabelNative`.
 * Passing `undefined`/an empty string clears it.
 */
export const setLabelNative = mutation({
  returns: v.object({ id: v.string(), number: v.number(), label: v.union(v.string(), v.null()) }),
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    versionId: v.string(),
    label: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, projectId, versionId, label, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const trimmed = label?.trim() || undefined;
    assertStrLen(trimmed, "label", LABEL_BOUNDS);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const version = await loadVersionInOrgProject(ctx, versionId, organizationId, projectId, "setLabelNative");

    await ctx.db.patch(version._id, { label: trimmed });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "PROJECT_VERSION_LABEL_SET",
      entityType: "project",
      entityId: projectId,
      entityName: `v${version.number}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: trimmed ? `Labelled v${version.number} "${trimmed}"` : `Cleared v${version.number}'s label`,
      details: { versionId, number: version.number, label: trimmed ?? null },
      projectId,
      createdAt: now,
    });

    return { id: versionId, number: version.number, label: trimmed ?? null };
  },
});

/**
 * DELETE (§4.4) — replaces `deleteDraftNative`/`deleteVersionNative` (both on
 * the older `quotes`-row model). Refuses the LIVE version — make another
 * version live first, then delete this one. Cascades: every row this
 * version owns across the 4 plan tables (`VERSIONED_PLAN_TABLES`) is deleted
 * along with the `projectVersions` row itself. Safe by construction: reality
 * (units/checks/maintenance/threads) only ever sits on rows tagged with the
 * CURRENT live version — `makeLiveNative`'s carry-over step re-points every
 * bit of it the moment a version stops being live, so a non-live version's
 * rows never have any live reality left to orphan.
 */
export const deleteNative = mutation({
  returns: v.object({ id: v.string(), number: v.number() }),
  args: {
    organizationId: v.string(),
    projectId: v.string(),
    versionId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, projectId, versionId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "project");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "project", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await requireProjectInOrg(ctx, projectId, organizationId);
    const version = await loadVersionInOrgProject(ctx, versionId, organizationId, projectId, "deleteNative");

    if (versionId === project.liveVersionId) {
      throw new ConvexError({
        code: "VERSION_IS_LIVE",
        message: `Version ${version.number} is live — make another version live before deleting it.`,
      });
    }

    const rowsByTable = await Promise.all(VERSIONED_PLAN_TABLES.map((t) => versionRows(ctx, t, versionId)));
    const total = rowsByTable.reduce((n, rows) => n + rows.length, 0);
    if (total > MAX_CLONABLE_PLAN_ROWS) {
      throw new ConvexError({
        code: "VERSION_TOO_LARGE",
        message: `This version has ${total} plan rows — too many to delete in one transaction (max ${MAX_CLONABLE_PLAN_ROWS}).`,
      });
    }
    let deletedRows = 0;
    for (const rows of rowsByTable) {
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deletedRows += 1;
      }
    }
    await ctx.db.delete(version._id);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "PROJECT_VERSION_DELETED",
      entityType: "project",
      entityId: projectId,
      entityName: project.projectNumber,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted v${version.number}`,
      details: { versionId, number: version.number, deletedRows },
      projectId,
      createdAt: now,
    });

    return { id: versionId, number: version.number };
  },
});

/** Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md
 *  §9 / CLAUDE.md's rubric). */
export const agentOps: AgentOpsAnnotations = {
  // Never touches the live tables/pointer — purely additive, a fresh
  // non-live version sitting alongside whatever's live. Same risk class as
  // the deleted saveVersionNative/repriceFromRevisionNative it replaces.
  createNative: { summary: "Copy a version's plan into a fresh, non-live version.", danger: "low", mcpTier: 2 },
  // Rewrites live project state (dates, client, notes, gear) from another
  // version — CLAUDE.md's high rubric ("stock-affecting, irreversible-
  // feeling, lock-softening") applies directly; the API dispatcher requires
  // confirm:true before this reaches Convex at all.
  makeLiveNative: { summary: "Flip the project's live pointer to another version.", danger: "high", mcpTier: 1 },
  // Internal metadata only, reachable on any version — same risk class as
  // quotesWrites.setQuoteLabelNative.
  setLabelNative: { summary: "Rename a version's internal label.", danger: "low", mcpTier: 3 },
  // Delete/archive is unconditionally high per the CLAUDE.md danger rubric —
  // permanently erases the version's row and every plan row it owns.
  deleteNative: { summary: "Permanently delete a non-live version and its plan rows.", danger: "high", mcpTier: 2 },
};
