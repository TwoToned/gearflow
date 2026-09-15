import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import { listProjectQuotes } from "./lib/quoteState";
import { listProjectVersions } from "./lib/projectVersionState";

/**
 * #1226 forward migration — Phase 1 of "Project versioning v2" (parent
 * #1221, docs/designs/project-versioning-v2.md §4.2/§6 step 1/§7).
 *
 * This is a SIMPLE, fresh-internal-mutation backfill, not a Prisma-mirror
 * write (so `createIfMissing`, CLAUDE.md's convention for mirroring a Prisma
 * row into Convex, doesn't apply here — `projectVersions` has no Prisma
 * model at all, same as `serviceSchedules`). Idempotency instead comes from
 * a plain check-before-write gate: **every write this backfill ever makes
 * for a project happens inside ONE mutation call** (insert the version row +
 * patch `projects.liveVersionId` + patch every child row's
 * `versionId`/`lineageId`, all in the same handler invocation), and Convex
 * commits a mutation's writes atomically. So the moment `project.liveVersionId`
 * is observed set, every child stamp for that same version is GUARANTEED to
 * already be in place too — there is no partial-migration state to detect or
 * repair, and skipping on `liveVersionId != null` is sufficient. A second run
 * finds `liveVersionId` set on every project and does nothing.
 *
 * Per project (paginated, `apply`-gated — same shape as
 * `backfillQuoteRevisions.ts` / `backfillProjectLiveRevision.ts`), **templates
 * included** (unlike those two — this program's #1226 spec explicitly wants
 * every project, `isTemplate: true` included, to end up with a version):
 *
 * 1. Insert ONE `projectVersions` row, `number: 1` (the only number this
 *    phase ever allocates — see the schema comment for why that alone makes
 *    per-project uniqueness hold "by construction" with no Convex-level
 *    unique-index mechanism).
 * 2. `projects.liveVersionId` <- that new version's id.
 * 3. Stamp `versionId` (= the new version's id) + `lineageId` (= the row's
 *    own `id`) on every current `projectCategories` / `projectGroups` /
 *    `projectLineItems` / `projectServices` / `categorySlots` row belonging
 *    to that project. `categorySlots` has no `projectId` of its own
 *    (PARENT_JOIN via `projectCategoryId`), so its rows are resolved through
 *    the project's own categories, gathered in the same pass.
 *
 * `contentState` is always `"ready"` — this phase creates exactly one
 * version per project representing its CURRENT state, which is fully
 * represented by the (about to be) versionId-tagged live rows. `"missing"`
 * is for a later phase's un-capturable pre-versioning history, never written
 * here.
 *
 * `label`: "check how quotes/labels currently work" (#1226) — a project's
 * most recently SENT quote's own `label` (`quotes.label`, #1085 — an
 * optional internal name, bounded ≤60 at that writer) if one exists,
 * otherwise the generic default below. `quotes.by_projectId` is a GLOBAL
 * index (R-8.4.3) — `listProjectQuotes` (`convex/lib/quoteState.ts`)
 * already re-checks `organizationId`, which is why this file goes through it
 * rather than querying `quotes` directly.
 *
 * `createdById` is required (no `?`) on `projectVersions`, but `projects`
 * tracks no "created by" user at all — there is no real creator to
 * attribute a synthesized version to. `BACKFILL_SYSTEM_USER_ID` names that
 * explicitly (same precedent as `wooCommerceActions.ts`'s `userId: "system"`
 * for an actor-less write) rather than silently picking an arbitrary real
 * user (e.g. the project manager) who did not, in fact, create this version.
 *
 * Driver: `scripts/convex-backfill-project-versions.ts`. SERVICE-only.
 */

export const BACKFILL_SYSTEM_USER_ID = "system";
const DEFAULT_VERSION_LABEL = "Version 1";

/** What one project still needs, or `null` when already migrated (every
 *  project on a re-run — see the idempotency note above). Read-only
 *  inspection, shared by `apply: false` (dry run / count) and `apply: true`
 *  so the two can never disagree about what work exists. */
interface ProjectWork {
  categories: Doc<"projectCategories">[];
  groups: Doc<"projectGroups">[];
  lineItems: Doc<"projectLineItems">[];
  services: Doc<"projectServices">[];
  slots: Doc<"categorySlots">[];
  label: string;
}

/** The most recently sent quote's label, else the generic default. */
function deriveVersionLabel(quotes: Doc<"quotes">[]): string {
  const sentWithLabel = quotes
    .filter((q) => q.sentAt != null && typeof q.label === "string" && q.label.length > 0)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  return sentWithLabel[0]?.label ?? DEFAULT_VERSION_LABEL;
}

async function planProjectWork(ctx: MutationCtx, project: Doc<"projects">): Promise<ProjectWork | null> {
  if (project.liveVersionId != null) return null; // already migrated (idempotent no-op)

  const orgId = project.organizationId;
  const [categoriesRaw, groupsRaw, lineItemsRaw, servicesRaw, quotes] = await Promise.all([
    ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect(),
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect(),
    ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", project.id)).collect(),
    listProjectQuotes(ctx, orgId, project.id),
  ]);
  // `by_projectId` is global on every one of these tables (R-8.4.3) — re-check
  // organizationId before treating a row as belonging to this project.
  const categories = categoriesRaw.filter((c) => c.organizationId === orgId);
  const groups = groupsRaw.filter((g) => g.organizationId === orgId);
  const lineItems = lineItemsRaw.filter((li) => li.organizationId === orgId);
  const services = servicesRaw.filter((s) => s.organizationId === orgId);

  // categorySlots carries no projectId of its own — resolved via the
  // project's own (already org-checked) categories.
  const slotsByCategory = await Promise.all(
    categories.map((c) =>
      ctx.db.query("categorySlots").withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", c.id)).collect(),
    ),
  );
  const slots = slotsByCategory.flat();

  return { categories, groups, lineItems, services, slots, label: deriveVersionLabel(quotes) };
}

/** The write half, split from the handler so the page loop stays a plain
 *  plan -> tally -> apply sequence (R-3.6). Every write below lands in the
 *  SAME mutation invocation, which is why the idempotency gate above is
 *  sufficient (see the file-level comment). */
async function applyProjectWork(ctx: MutationCtx, project: Doc<"projects">, work: ProjectWork): Promise<void> {
  const versionId = createId();
  await ctx.db.insert("projectVersions", {
    id: versionId,
    organizationId: project.organizationId,
    projectId: project.id,
    number: 1,
    label: work.label,
    createdAt: Date.now(),
    createdById: BACKFILL_SYSTEM_USER_ID,
    contentState: "ready",
  });
  await ctx.db.patch(project._id, { liveVersionId: versionId });

  // Five separate loops (not one combined array) so each `ctx.db.patch` keeps
  // its table-specific `Id<...>` type — a mixed-table array would widen the
  // `_id` brand and lose that.
  for (const row of work.categories) await ctx.db.patch(row._id, { versionId, lineageId: row.id });
  for (const row of work.groups) await ctx.db.patch(row._id, { versionId, lineageId: row.id });
  for (const row of work.lineItems) await ctx.db.patch(row._id, { versionId, lineageId: row.id });
  for (const row of work.services) await ctx.db.patch(row._id, { versionId, lineageId: row.id });
  for (const row of work.slots) await ctx.db.patch(row._id, { versionId, lineageId: row.id });
}

export const backfillProjectVersionsPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    versionsCreated: v.number(),
    childRowsStamped: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    // Deliberately NO `isTemplate` skip — #1226 wants every project, templates
    // included, to end up with a version + `liveVersionId`.
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 100 });

    const tally = { scanned: 0, versionsCreated: 0, childRowsStamped: 0 };
    for (const project of res.page) {
      const work = await planProjectWork(ctx, project);
      if (!work) continue;

      tally.scanned++;
      tally.versionsCreated++;
      tally.childRowsStamped +=
        work.categories.length + work.groups.length + work.lineItems.length + work.services.length + work.slots.length;
      if (apply) await applyProjectWork(ctx, project, work);
    }
    return { ...tally, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/**
 * Verification — the "prove zero un-migrated rows, and no cross-project
 * pointer" query. Every count must read 0 after a full apply run. Paginated
 * like the migration itself so it can't blow the read limit on a large org
 * — the driver accumulates across pages.
 *
 * `projectsWithBadVersionPointer` is the check CLAUDE.md's `by_cuid` note
 * exists for: `liveVersionId` is resolved by cuid (a global index) and MUST
 * point at a `projectVersions` row whose own `projectId`/`organizationId`
 * match the project doing the pointing — a mismatch here is exactly the
 * cross-tenant-pointer bug class the issue calls out, not a hypothetical.
 */
const EMPTY_COUNTS = {
  totalProjects: 0,
  projectsMissingLiveVersionId: 0,
  projectsWithBadVersionPointer: 0,
  projectsWithVersionCountNotOne: 0,
};
type VerifyCounts = typeof EMPTY_COUNTS;

async function inspectProject(ctx: QueryCtx, project: Doc<"projects">): Promise<VerifyCounts> {
  const counts = { ...EMPTY_COUNTS, totalProjects: 1 };

  if (project.liveVersionId == null) {
    counts.projectsMissingLiveVersionId = 1;
  } else {
    const pointee = await ctx.db
      .query("projectVersions")
      .withIndex("by_cuid", (q) => q.eq("id", project.liveVersionId!))
      .first();
    if (!pointee || pointee.projectId !== project.id || pointee.organizationId !== project.organizationId) {
      counts.projectsWithBadVersionPointer = 1;
    }
  }

  // Org-checked read — see convex/lib/projectVersionState.ts.
  const versions = await listProjectVersions(ctx, project.organizationId, project.id);
  if (versions.length !== 1) counts.projectsWithVersionCountNotOne = 1;

  return counts;
}

export const verifyProjectVersions = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  returns: v.object({
    totalProjects: v.number(),
    projectsMissingLiveVersionId: v.number(),
    projectsWithBadVersionPointer: v.number(),
    projectsWithVersionCountNotOne: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projects").paginate({ cursor, numItems: numItems ?? 100 });

    const totals = { ...EMPTY_COUNTS };
    for (const project of res.page) {
      const counts = await inspectProject(ctx, project);
      for (const key of Object.keys(totals) as (keyof VerifyCounts)[]) totals[key] += counts[key];
    }
    return { ...totals, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** Guard used by the driver so a mismatch between the counted project total
 *  and the operator's `--expect-projects` halts BEFORE anything is written.
 *  Exported (and unit-tested) rather than inlined in the script — mirrors
 *  `backfillQuoteRevisions.ts`'s `assertExpectedQuoteRows`. */
export function assertExpectedProjectCount(counted: number, expected: number | undefined): void {
  if (expected === undefined) return;
  if (counted !== expected) {
    throw new ConvexError(
      `Refusing to migrate: expected ${expected} project(s), found ${counted}. ` +
        "Re-run the dry run and confirm the figure before applying.",
    );
  }
}
