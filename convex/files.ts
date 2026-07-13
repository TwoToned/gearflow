import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireService } from "./lib/auth";

/**
 * Convex file storage (replaces the self-hosted Garage/S3 box). The bytes live in
 * Convex `_storage`; this module manages the org-association records (`storedFiles`)
 * that the `/api/files` proxy uses to authorise a serve — preserving the old per-org
 * access model without S3's org-prefixed keys.
 *
 * All SERVICE-gated: the Next.js server (`src/lib/storage.ts`) is the only caller,
 * via the service token. Uploads go: server → generateUploadUrl → POST bytes to that
 * URL → register(storageId, org). Serves go: server → getServeInfo → stream getUrl.
 */

/** Mint a one-time upload URL. The server POSTs the file bytes to it and gets a storageId. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireService(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Record a freshly-uploaded file's org association (idempotent by storageId). */
export const register = mutation({
  args: {
    storageId: v.string(),
    organizationId: v.string(),
    folder: v.optional(v.string()),
    fileName: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("storedFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (existing) return;
    await ctx.db.insert("storedFiles", args);
  },
});

/**
 * Serve info for the proxy: the file's org (for the auth check), a short-lived
 * download URL, and content metadata. Null if the storageId has no record (deny).
 */
export const getServeInfo = query({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    await requireService(ctx);
    const rec = await ctx.db
      .query("storedFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .unique();
    if (!rec) return null;
    const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
    if (!url) return null; // bytes gone
    const meta = await ctx.db.system.get(storageId as Id<"_storage">);
    return {
      organizationId: rec.organizationId,
      url,
      contentType: meta?.contentType ?? null,
      size: meta?.size ?? null,
      fileName: rec.fileName ?? null,
    };
  },
});

/** Delete a file: its bytes + its org record. Idempotent. */
export const deleteFile = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    await requireService(ctx);
    const rec = await ctx.db
      .query("storedFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .unique();
    if (rec) await ctx.db.delete(rec._id);
    try {
      await ctx.storage.delete(storageId as Id<"_storage">);
    } catch {
      // already gone — idempotent
    }
  },
});
