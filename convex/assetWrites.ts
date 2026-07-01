import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";

/**
 * Native ASSET write mutations (Phase 5 — Convex becomes the domain layer, not just
 * a write target).
 *
 * ADDITIVE + ISOLATED: the generated service mutations in convex/assets.ts are left
 * untouched, so the live server-action write path is unchanged. These new mutations
 * are the native path — each enforces, in ONE transaction:
 *   • RBAC (requireOrgPermission — 5a): the same resource/action the server action's
 *     requirePermission checked, now unbypassable at the Convex boundary. Because
 *     Convex mutations are PUBLIC, this is what makes it safe for a browser/user token
 *     to call the mutation directly (5d optimistic) — relaxing requireService without
 *     this would open a hole.
 *   • Domain invariants (5b): per-mutation (dup-tag guards, status rules, …).
 *   • Atomic audit (5c): the activityLogs row is written in the same transaction as
 *     the data change via writeActivityLog, so data + audit can't drift.
 *
 * `actor` carries the acting user for the audit trail (a service-token call has no
 * user identity of its own, so the caller passes it; a user-token call can pass its
 * own id). `auditId` + `now` are caller-generated (a Convex mutation can't mint a
 * cuid — Math.random is non-deterministic) and keep the write deterministic.
 *
 * `updateNotesNative` is the mechanism-prover: the simplest asset write (notes-only,
 * no cross-entity invariant) exercising the full RBAC + atomic-audit pattern that the
 * heavier create/update/delete mutations will reuse.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const updateNotesNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, notes, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "asset", "update");

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (!asset) throw new ConvexError("Asset not found: " + id);
    // Defence in depth: the RBAC guard already checked the token's org, but the
    // asset must belong to it too (a valid member of org A can't edit org B's asset).
    if (asset.organizationId !== orgId) {
      throw new ConvexError("Forbidden: organization mismatch.");
    }

    // `undefined` clears the field (matches updateAssetNotes' clear-to-null).
    await ctx.db.patch(asset._id, { notes: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "asset",
      entityId: id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated notes on asset ${asset.assetTag}`,
      assetId: id,
      createdAt: now,
    });

    return { ok: true as const };
  },
});
