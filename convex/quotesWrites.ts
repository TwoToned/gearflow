import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";
import { assertRefInOrg } from "./lib/orgRef";
import { assertLifecycleGuard } from "./lib/projectLocks";
import { buildFinanceLines } from "./lib/financeSnapshot";

/**
 * Quote write mutations (WS1 #940) — browser-direct, the standard 4-guard
 * shape (FEATUREDOCS/54). Publish = SNAPSHOT the project's current pricing
 * into a new, versioned, immutable row; republish supersedes the previous
 * PUBLISHED quote (never overwritten in place — the client saw a real
 * document at version N, so it stays retrievable even after version N+1
 * exists). The snapshot money is built server-side from the project's own
 * recalc-owned totals + `buildFinanceLines` (R-9.3 — no client-supplied
 * amount is ever trusted).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

function assertQuoteFields(f: { notes?: string }): void {
  assertStrLen(f.notes, "notes", { max: 2000 });
}

export const publishNative = mutation({
  returns: v.object({ id: v.string(), version: v.number() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    notes: v.optional(v.string()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "quote");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, organizationId, "invoice", "publish");
    const actor = await resolveActor(ctx, suppliedActor);
    assertQuoteFields({ notes });

    await assertRefInOrg(ctx, "projects", projectId, organizationId);
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project) throw new ConvexError("Project not found: " + projectId);
    await assertLifecycleGuard(ctx, project, { kind: "financial" });

    // Dup-guard the client-minted id (by_cuid is global + non-unique).
    const dup = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError("Quote already exists");

    // Supersede the current PUBLISHED quote for this project, if any.
    const existingPublished = await ctx.db
      .query("quotes")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .filter((q) => q.eq(q.field("status"), "PUBLISHED"))
      .collect();
    let nextVersion = 1;
    for (const q of existingPublished) {
      nextVersion = Math.max(nextVersion, (q.version ?? 0) + 1);
      await ctx.db.patch(q._id, { status: "SUPERSEDED", updatedAt: now });
    }
    // Also account for any prior SUPERSEDED versions when computing the next
    // number (a project republished 3x should reach version 4, not loop at 2).
    const allForProject = await ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect();
    for (const q of allForProject) nextVersion = Math.max(nextVersion, (q.version ?? 0) + 1);

    const lines = await buildFinanceLines(ctx, projectId);
    const snapshot = {
      lines,
      subtotal: Number(project.subtotal) || 0,
      discountPercent: Number(project.discountPercent) || 0,
      discountAmount: Number(project.discountAmount) || 0,
      taxRate: project.taxRate != null ? Number(project.taxRate) : null,
      taxAmount: Number(project.taxAmount) || 0,
      total: Number(project.total) || 0,
      notes: notes ?? null,
    };

    await ctx.db.insert("quotes", {
      id,
      organizationId,
      projectId,
      version: nextVersion,
      status: "PUBLISHED",
      snapshot,
      publishedAt: now,
      publishedById: actor.userId,
      createdById: actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "quote",
      entityId: id,
      entityName: `Quote v${nextVersion} — ${project.name}`,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Published quote v${nextVersion} for ${project.name}`,
      projectId,
      createdAt: now,
    });

    return { id, version: nextVersion };
  },
});

export const quoteFields = { notes: v.optional(v.string()) };
