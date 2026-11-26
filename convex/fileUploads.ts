import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService, requireOrgReadFor, requireOrgReadDocFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { deleteStoredFileIfUnreferenced } from "./lib/deleteStoredFile";
import { CREW_DOCUMENTS_FOLDER } from "./lib/crewDocumentCore";

/**
 * Thin CRUD for FileUpload (Convex table "fileUploads"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

/**
 * A crew document's file is identity material (owner ruling B2) and is only ever reached through the gated crew
 * document routes. Its `fileUploads` row would still leak the file name, size and storage key to any
 * `document:read` caller (or API key), so every generic read here drops a row whose stored folder is
 * `crew-documents`, whoever asks (the service identity included: none of these callers has a reason to want one).
 */
async function withoutCrewDocumentFiles(ctx: QueryCtx, files: Doc<"fileUploads">[]): Promise<Doc<"fileUploads">[]> {
  const stored = await Promise.all(files.map((f) => ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", f.storageKey)).unique()));
  return files.filter((_, i) => stored[i]?.folder !== CREW_DOCUMENTS_FOLDER);
}

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "document"); // Phase 5 domain slice (#1001)
    const files = await ctx.db
      .query("fileUploads")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
    return await withoutCrewDocumentFiles(ctx, files);
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "document"); // Phase 5 domain slice (#1001)
    return doc ? ((await withoutCrewDocumentFiles(ctx, [doc]))[0] ?? null) : doc;
  },
});

/**
 * Lookup a file by its proxy `thumbnailUrl` (the data-URI fallback in
 * src/lib/storage.ts). Service-only, cross-org (the caller has no orgId in that
 * path). No index on thumbnailUrl (rare fallback), so this scans + filters.
 */
export const getByThumbnailUrl = query({
  args: { thumbnailUrl: v.string() },
  handler: async (ctx, { thumbnailUrl }) => {
    await requireService(ctx);
    // Point-lookup via by_thumbnailUrl instead of scanning the whole (cross-org)
    // fileUploads table. .first() matches the old .find() (first/only match).
    const file = await ctx.db
      .query("fileUploads")
      .withIndex("by_thumbnailUrl", (q) => q.eq("thumbnailUrl", thumbnailUrl))
      .first();
    return file ? ((await withoutCrewDocumentFiles(ctx, [file]))[0] ?? null) : file;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    storageKey: v.string(),
    url: v.string(),
    thumbnailUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    uploadedById: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("fileUploads", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    storageKey: v.string(),
    url: v.string(),
    thumbnailUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    uploadedById: v.string(),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("fileUploads", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      fileName: v.optional(v.string()),
      fileSize: v.optional(v.number()),
      mimeType: v.optional(v.string()),
      storageKey: v.optional(v.string()),
      url: v.optional(v.string()),
      thumbnailUrl: v.optional(v.string()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      uploadedById: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("fileUploads not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("fileUploads not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator; re-add on regen. ──
// The ONE remove rule for the legacy server path (`src/lib/media-write.ts`, sub-hire media): delete the
// file (bytes, thumbnail, records) ONLY when nothing holds it, after the caller's own media row is gone.
// Service-only; org-checked inside (`deleteStoredFileIfUnreferenced`).
export const removeIfUnreferenced = mutation({
  args: { orgId: v.string(), fileId: v.string() },
  handler: async (ctx, { orgId, fileId }) => {
    await requireService(ctx);
    return await deleteStoredFileIfUnreferenced(ctx, orgId, fileId);
  },
});

// Is this file referenced by ANY media row across the 7 *_media tables? Replaces
// the raw-SQL UNION ref-count in removeSubHireMedia (each table has a by_fileId
// index). Used to decide whether deleting a media row should also delete its file.
export const isReferencedByMedia = query({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }) => {
    await requireService(ctx);
    const tables = [
      "modelMedia",
      "assetMedia",
      "kitMedia",
      "projectMedia",
      "clientMedia",
      "locationMedia",
      "subHireMedia",
    ] as const;
    for (const t of tables) {
      const hit = await ctx.db
        .query(t)
        .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
        .first();
      if (hit) return true;
    }
    return false;
  },
});

/**
 * Agent-op annotations (Phase 5, #1001). `list`/`getById` widened — they
 * return file metadata/pointers (name/size/mimeType/storageKey/url), org-
 * checked. `getByThumbnailUrl` and `isReferencedByMedia` stay denied: both are
 * documented cross-org lookups with no orgId argument to check the caller
 * against (structurally the same "no org to scope by" issue as
 * `orgSettings.getByIcalToken`).
 */
const fileUploadsCrossOrgDenyReason =
  "Cross-org lookup with no orgId argument to check the caller's org against — structurally not an org-scoped read (see the function's own doc comment).";

export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List the org's uploaded-file records (metadata, not bytes).", danger: "low", mcpTier: 3 },
  getById: { summary: "Get one uploaded-file record by id.", danger: "low", mcpTier: 3 },
  getByThumbnailUrl: { agentAccess: "denied", reason: fileUploadsCrossOrgDenyReason },
  isReferencedByMedia: { agentAccess: "denied", reason: fileUploadsCrossOrgDenyReason },
  removeIfUnreferenced: { agentAccess: "denied", reason: "Service-only: the legacy server removal path decides for the real caller." },
};
