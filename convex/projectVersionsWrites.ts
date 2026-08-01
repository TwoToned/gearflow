import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { assertLifecycleGuard } from "./lib/projectLocks";
import { captureProjectSnapshot } from "./lib/projectSnapshots";
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
};
