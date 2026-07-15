import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";

/**
 * Native MEDIA write mutations (Phase 3 browser-direct — replaces the 6 *-media.ts
 * server actions: client/location/project/kit/asset/model). Files live in CONVEX
 * STORAGE (not S3), so the whole add/remove/setPrimary/reorder path is pure Convex.
 * ONE mutation set, dispatched by `kind`. Each runs the 4 write guards (writes-enabled
 * + rate limit + parent `<resource>:update` RBAC + org membership via requireOrgPermission)
 * + per-row org re-check (media/parent/file all fetched by the GLOBAL by_cuid index).
 * Remove deletes the row + its file (stored bytes + storedFiles record + fileUploads
 * row, replicating files.deleteFile) + promotes the next primary photo. The original
 * server actions did NO logActivity → none here (parity). subHire media stays on the
 * media-write.ts helpers (sub-hires.ts, with refCountFile) — not covered here.
 */

const MediaKind = v.union(v.literal("client"), v.literal("location"), v.literal("project"), v.literal("kit"), v.literal("asset"), v.literal("model"));
type Kind = "client" | "location" | "project" | "kit" | "asset" | "model";

type MediaTable = "clientMedia" | "locationMedia" | "projectMedia" | "kitMedia" | "assetMedia" | "modelMedia";
type ParentTable = "clients" | "locations" | "projects" | "kits" | "assets" | "models";
type Resource = "client" | "location" | "project" | "kit" | "asset" | "model";

const CFG: Record<Kind, { table: MediaTable; fk: string; parentTable: ParentTable; parentIndex: string; resource: Resource; photo: boolean }> = {
  client: { table: "clientMedia", fk: "clientId", parentTable: "clients", parentIndex: "by_clientId", resource: "client", photo: false },
  location: { table: "locationMedia", fk: "locationId", parentTable: "locations", parentIndex: "by_locationId", resource: "location", photo: false },
  project: { table: "projectMedia", fk: "projectId", parentTable: "projects", parentIndex: "by_projectId", resource: "project", photo: false },
  kit: { table: "kitMedia", fk: "kitId", parentTable: "kits", parentIndex: "by_kitId", resource: "kit", photo: true },
  asset: { table: "assetMedia", fk: "assetId", parentTable: "assets", parentIndex: "by_assetId", resource: "asset", photo: true },
  model: { table: "modelMedia", fk: "modelId", parentTable: "models", parentIndex: "by_modelId", resource: "model", photo: true },
};

/** A media row — the fields we touch are common across all 6 media tables. */
type MediaRow = { _id: Id<MediaTable>; id: string; organizationId: string; fileId: string; type?: string | null; isPrimary?: boolean | null; sortOrder?: number | null; [fk: string]: unknown };

/** Rows for a parent, org re-checked (the by_<parent>Id index is GLOBAL). */
async function rowsByParent(ctx: MutationCtx, cfg: (typeof CFG)[Kind], parentId: string, orgId: string): Promise<MediaRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await ctx.db.query(cfg.table).withIndex(cfg.parentIndex as any, (q: any) => q.eq(cfg.fk, parentId)).collect()) as MediaRow[];
  return rows.filter((r) => r.organizationId === orgId);
}

async function mediaByCuid(ctx: MutationCtx, cfg: (typeof CFG)[Kind], mediaId: string): Promise<MediaRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await ctx.db.query(cfg.table).withIndex("by_cuid", (q: any) => q.eq("id", mediaId)).first()) as MediaRow | null;
}

/** Verify the parent entity exists in the caller's org (by_cuid is global). */
async function assertParentInOrg(ctx: MutationCtx, cfg: (typeof CFG)[Kind], parentId: string, orgId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent = (await ctx.db.query(cfg.parentTable).withIndex("by_cuid", (q: any) => q.eq("id", parentId)).first()) as { organizationId: string } | null;
  if (!parent || parent.organizationId !== orgId) throw new ConvexError("Parent not found");
}

async function guards(ctx: MutationCtx, kind: Kind, orgId: string) {
  await assertWritesEnabled(ctx, "media");
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, CFG[kind].resource, "update");
}

export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { kind: MediaKind, id: v.string(), orgId: v.string(), parentId: v.string(), fileId: v.string(), type: v.string(), displayName: v.optional(v.string()), now: v.number() },
  handler: async (ctx, a) => {
    await guards(ctx, a.kind, a.orgId);
    const cfg = CFG[a.kind];
    await assertParentInOrg(ctx, cfg, a.parentId, a.orgId);

    const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", a.fileId)).first();
    if (!file || file.organizationId !== a.orgId) throw new ConvexError("File not found");

    const dup = await mediaByCuid(ctx, cfg, a.id);
    if (dup) throw new ConvexError("Media already exists");

    const existing = await rowsByParent(ctx, cfg, a.parentId, a.orgId);
    const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? -1), -1);
    const isPrimary = cfg.photo && a.type === "PHOTO" ? existing.filter((r) => r.type === "PHOTO").length === 0 : false;

    const doc: Record<string, unknown> = { id: a.id, organizationId: a.orgId, [cfg.fk]: a.parentId, fileId: a.fileId, type: a.type, sortOrder: maxSort + 1, createdAt: a.now };
    if (a.displayName !== undefined) doc.displayName = a.displayName;
    if (cfg.photo) doc.isPrimary = isPrimary;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.insert(cfg.table, doc as any);
    return { id: a.id };
  },
});

export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { kind: MediaKind, orgId: v.string(), mediaId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.kind, a.orgId);
    const cfg = CFG[a.kind];

    const media = await mediaByCuid(ctx, cfg, a.mediaId);
    if (!media || media.organizationId !== a.orgId) throw new ConvexError("Media not found");
    const parentId = media[cfg.fk] as string;
    const wasPrimary = media.isPrimary ?? false;
    const fileId = media.fileId;

    await ctx.db.delete(media._id);

    // Delete the file: stored bytes + storedFiles record (replicating files.deleteFile)
    // + thumbnail bytes + the fileUploads row. Unconditional (the 6 UI kinds never
    // ref-count — that path stays on media-write.ts for subHire).
    // Org-check the file too (by_cuid is global) — add enforces file.org == media.org,
    // so this only guards against a corrupt/mismatched row deleting another org's file.
    const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
    if (file && file.organizationId === a.orgId) {
      await deleteStored(ctx, file.storageKey);
      if (file.thumbnailUrl) {
        const thumb = storageIdFromUrl(file.thumbnailUrl);
        if (thumb) await deleteStored(ctx, thumb);
      }
      await ctx.db.delete(file._id);
    }

    // Promote the next PHOTO if the removed one was primary (photo kinds only).
    if (cfg.photo && wasPrimary && media.type === "PHOTO") {
      const next = (await rowsByParent(ctx, cfg, parentId, a.orgId))
        .filter((r) => r.type === "PHOTO")
        .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))[0];
      if (next) await ctx.db.patch(next._id, { isPrimary: true });
    }
    return { id: a.mediaId };
  },
});

export const setPrimaryNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { kind: MediaKind, orgId: v.string(), parentId: v.string(), mediaId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.kind, a.orgId);
    const cfg = CFG[a.kind];
    if (!cfg.photo) throw new ConvexError(`${a.kind} media has no primary photo`);

    const target = await mediaByCuid(ctx, cfg, a.mediaId);
    if (!target || target.organizationId !== a.orgId || target[cfg.fk] !== a.parentId || target.type !== "PHOTO") throw new ConvexError("Media not found");

    for (const r of await rowsByParent(ctx, cfg, a.parentId, a.orgId)) {
      if (r.id === a.mediaId) { if (!r.isPrimary) await ctx.db.patch(r._id, { isPrimary: true }); }
      else if (r.type === "PHOTO" && r.isPrimary) await ctx.db.patch(r._id, { isPrimary: false });
    }
    return { id: a.mediaId };
  },
});

export const reorderNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { kind: MediaKind, orgId: v.string(), orderedIds: v.array(v.string()) },
  handler: async (ctx, a) => {
    await guards(ctx, a.kind, a.orgId);
    const cfg = CFG[a.kind];
    for (let i = 0; i < a.orderedIds.length; i++) {
      const doc = await mediaByCuid(ctx, cfg, a.orderedIds[i]);
      if (doc && doc.organizationId === a.orgId) await ctx.db.patch(doc._id, { sortOrder: i }); // per-item org re-check
    }
    return { ok: true };
  },
});

// ── Storage helpers (replicate files.deleteFile: storedFiles record + bytes) ──
async function deleteStored(ctx: MutationCtx, storageId: string) {
  const rec = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
  if (rec) await ctx.db.delete(rec._id);
  try {
    await ctx.storage.delete(storageId as Id<"_storage">);
  } catch {
    // already gone — idempotent
  }
}
/** Extract the storage id from a `/api/files/{id}` proxy url (mirrors storageKeyFromUrl). */
function storageIdFromUrl(url: string): string | null {
  const prefix = "/api/files/";
  const idx = url.indexOf(prefix);
  return idx === -1 ? null : url.slice(idx + prefix.length);
}
