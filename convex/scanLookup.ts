import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Resolve a scanned barcode/tag value to a navigation target (Phase 3 — replaces the
 * `scanLookup` server action). Browser-callable (`requireOrgRead`; service tokens
 * short-circuit allow, so the `scan_lookup` agent tool works via CONVEX_READS). Checks,
 * in order: serialized asset → kit → bulk asset → test&tag item (by testTagId). Cheap
 * point-reads on org-scoped indexes.
 */
const SAFE_TAG = /^[A-Za-z0-9\-_.:/ ]+$/;

export const resolve = query({
  args: { orgId: v.string(), value: v.string() },
  returns: v.object({ url: v.union(v.string(), v.null()), label: v.union(v.string(), v.null()) }),
  handler: async (ctx, { orgId, value }): Promise<{ url: string | null; label: string | null }> => {
    await requireOrgRead(ctx, orgId);

    const tag = value.trim();
    if (!tag || tag.length > 128 || !SAFE_TAG.test(tag)) {
      return { url: null, label: null };
    }

    const asset = await ctx.db
      .query("assets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
      .first();
    if (asset) return { url: `/assets/registry/${asset.id}`, label: `Asset ${asset.assetTag}` };

    const kit = await ctx.db
      .query("kits")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
      .first();
    if (kit) return { url: `/kits/${kit.id}`, label: `Kit ${kit.assetTag}` };

    const bulk = await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", orgId).eq("assetTag", tag))
      .first();
    if (bulk) return { url: `/assets/registry/${bulk.id}`, label: `Bulk Asset ${bulk.assetTag}` };

    const tt = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) => q.eq("organizationId", orgId).eq("testTagId", tag))
      .first();
    if (tt) return { url: `/test-and-tag/${tt.id}`, label: `T&T ${tt.testTagId}` };

    return { url: null, label: null };
  },
});
