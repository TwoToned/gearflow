import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit, assertBulkSizeOk } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import { emitProjectActivityEvent } from "./lib/activityEvents";
import { ProjectMediaType as ProjectMediaTypeV } from "./lib/validators";

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

/** Another row of this media table that already points at the file (its `by_fileId` index is global; the file is org-checked by the caller). */
async function otherRowsForFile(ctx: MutationCtx, cfg: (typeof CFG)[Kind], fileId: string, exceptId?: string): Promise<boolean> {
  const rows = await mediaRowsByFile(ctx, cfg.table, fileId);
  return rows.some((r) => r.id !== exceptId);
}

/** Up to two rows of one media table pointing at a file (each table has its own typed `by_fileId` index). */
async function mediaRowsByFile(ctx: MutationCtx, table: MediaTable, fileId: string): Promise<{ id: string }[]> {
  switch (table) {
    case "clientMedia":
      return ctx.db.query("clientMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).take(2);
    case "locationMedia":
      return ctx.db.query("locationMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).take(2);
    case "projectMedia":
      return ctx.db.query("projectMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).take(2);
    case "kitMedia":
      return ctx.db.query("kitMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).take(2);
    case "assetMedia":
      return ctx.db.query("assetMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).take(2);
    case "modelMedia":
      return ctx.db.query("modelMedia").withIndex("by_fileId", (q) => q.eq("fileId", fileId)).take(2);
  }
}

/**
 * A file may be ATTACHED only if it is the caller's own fresh upload that nothing else
 * already holds (a removal later deletes the stored bytes, so attaching someone else's
 * file, or one a quote / sub-hire / another row uses, would let a remove destroy it).
 * A job's file must also come from the job upload folder. A service identity (no user
 * to compare) skips the uploader test; every other check still applies.
 */
async function assertFileAttachable(ctx: MutationCtx, cfg: (typeof CFG)[Kind], a: { kind: Kind; orgId: string }, file: { id: string; storageKey: string; uploadedById: string }) {
  const actor = await resolveActor(ctx, { userId: "", userName: "" });
  if (actor.userId && file.uploadedById !== actor.userId) throw new ConvexError("You can only attach a file you uploaded");
  if (await otherRowsForFile(ctx, cfg, file.id)) throw new ConvexError("That file is already attached");
  if (a.kind !== "project") return;
  const stored = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).first();
  if (!stored || stored.organizationId !== a.orgId || stored.folder !== "projects") throw new ConvexError("That file was not uploaded to this job");
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
    await assertFileAttachable(ctx, cfg, a, file);

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
    await emitFileEvent(ctx, a.kind, a.orgId, a.parentId, a.now, "file_added", `added file "${a.displayName ?? file.fileName}"`, a.id);
    return { id: a.id };
  },
});

/** The Activity rail for a JOB's file writes (UX Phase 10). Other kinds have no job feed. */
async function emitFileEvent(ctx: MutationCtx, kind: Kind, orgId: string, parentId: string, now: number, action: string, summary: string, mediaId: string) {
  if (kind !== "project") return;
  const actor = await resolveActor(ctx, { userId: "", userName: "" });
  await emitProjectActivityEvent(ctx, { orgId, projectId: parentId, actor, now, action, summary, targetType: "file", targetId: mediaId });
}

/**
 * Remove ONE media row (org-checked) and, only when nothing else still holds the file, its
 * stored bytes. Throws "Media not found" BEFORE any write, so a caller looping over several
 * rows can skip a missing one without leaving a half-done removal behind.
 */
async function removeMediaRow(ctx: MutationCtx, kind: Kind, orgId: string, mediaId: string): Promise<void> {
  const cfg = CFG[kind];
  const media = await mediaByCuid(ctx, cfg, mediaId);
  if (!media || media.organizationId !== orgId) throw new ConvexError("Media not found");
  const parentId = media[cfg.fk] as string;
  const wasPrimary = media.isPrimary ?? false;
  const fileId = media.fileId;
  const label = (media.displayName as string | undefined) ?? (await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first())?.fileName ?? "a file";

  await ctx.db.delete(media._id);
  await emitFileEvent(ctx, kind, orgId, parentId, Date.now(), "file_removed", `removed file "${label}"`, mediaId);

  // Delete the file (stored bytes + storedFiles record + thumbnail bytes + the fileUploads row)
  // ONLY when nothing else still holds it. Org-check the file too (by_cuid is global).
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  if (file && file.organizationId === orgId && !(await otherRowsForFile(ctx, cfg, fileId))) {
    await deleteStored(ctx, file.storageKey);
    if (file.thumbnailUrl) {
      const thumb = storageIdFromUrl(file.thumbnailUrl);
      if (thumb) await deleteStored(ctx, thumb);
    }
    await ctx.db.delete(file._id);
  }

  // Promote the next PHOTO if the removed one was primary (photo kinds only).
  if (cfg.photo && wasPrimary && media.type === "PHOTO") {
    const next = (await rowsByParent(ctx, cfg, parentId, orgId))
      .filter((r) => r.type === "PHOTO")
      .sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))[0];
    if (next) await ctx.db.patch(next._id, { isPrimary: true });
  }
}

export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { kind: MediaKind, orgId: v.string(), mediaId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.kind, a.orgId);
    await removeMediaRow(ctx, a.kind, a.orgId, a.mediaId);
    return { id: a.mediaId };
  },
});

/**
 * Remove several media rows in ONE mutation (the Files bulk bar), by the same rule as
 * `removeNative`: bytes go only for a file nothing else holds. A row that is not found
 * (or another org's) is skipped and NAMED, never silent; the bulk size is capped by the
 * verified identity (`assertBulkSizeOk`).
 */
export const removeManyNative = mutation({
  returns: v.object({ removed: v.number(), skipped: v.array(v.object({ id: v.string(), why: v.string() })) }),
  args: { kind: MediaKind, orgId: v.string(), mediaIds: v.array(v.string()) },
  handler: async (ctx, a) => {
    await guards(ctx, a.kind, a.orgId);
    await assertBulkSizeOk(ctx, a.mediaIds.length);
    let removed = 0;
    const skipped: { id: string; why: string }[] = [];
    for (const id of new Set(a.mediaIds)) {
      try {
        await removeMediaRow(ctx, a.kind, a.orgId, id);
        removed++;
      } catch (e) {
        if (!(e instanceof ConvexError)) throw e;
        skipped.push({ id, why: "not found" });
      }
    }
    return { removed, skipped };
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

/**
 * Set the CATEGORY of one or more project files (UX Phase 10, spec §8c: a category
 * per file, the `ProjectMediaType` enum). Project media only. Per-row org + parent
 * check (`by_cuid` is global); a file that is not this job's is skipped and reported.
 * One Activity event per call. Only `type` changes: no stored file is touched.
 */
export const setTypeNative = mutation({
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  args: { orgId: v.string(), projectId: v.string(), mediaIds: v.array(v.string()), type: ProjectMediaTypeV, now: v.number() },
  handler: async (ctx, a) => {
    await guards(ctx, "project", a.orgId);
    await assertBulkSizeOk(ctx, a.mediaIds.length);
    const cfg = CFG.project;
    await assertParentInOrg(ctx, cfg, a.projectId, a.orgId);
    let updated = 0;
    for (const id of a.mediaIds) {
      const doc = await mediaByCuid(ctx, cfg, id);
      if (!doc || doc.organizationId !== a.orgId || doc[cfg.fk] !== a.projectId) continue;
      if (doc.type !== a.type) await ctx.db.patch(doc._id, { type: a.type });
      updated++;
    }
    if (updated > 0) {
      const actor = await resolveActor(ctx, { userId: "", userName: "" });
      await emitProjectActivityEvent(ctx, {
        orgId: a.orgId, projectId: a.projectId, actor, now: a.now, action: "file_updated", targetType: "file",
        summary: `changed ${updated} ${updated === 1 ? "file" : "files"} to ${a.type.toLowerCase().replace(/_/g, " ")}`,
      });
    }
    return { updated, skipped: a.mediaIds.length - updated };
  },
});

/** Rename one project file (`displayName`, 1-200 chars). The stored file and its name on disk are untouched. */
export const renameNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), projectId: v.string(), mediaId: v.string(), displayName: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await guards(ctx, "project", a.orgId);
    const cfg = CFG.project;
    const name = a.displayName.trim();
    if (!name) throw new ConvexError("A file needs a name");
    assertStrLen(name, "displayName", { max: 200 });
    const doc = await mediaByCuid(ctx, cfg, a.mediaId);
    if (!doc || doc.organizationId !== a.orgId || doc[cfg.fk] !== a.projectId) throw new ConvexError("Media not found");
    await ctx.db.patch(doc._id, { displayName: name });
    await emitFileEvent(ctx, "project", a.orgId, a.projectId, a.now, "file_updated", `renamed a file to "${name}"`, a.mediaId);
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

export const agentOps: AgentOpsAnnotations = {
  setTypeNative: { summary: "Set the category of one or more project files (the ProjectMediaType enum). Changes only the category.", danger: "low", mcpTier: 3 },
  renameNative: { summary: "Rename a project file's display name; the stored file is untouched.", danger: "low", mcpTier: 3 },
  removeManyNative: { summary: "Remove several files from a job in one call; deletes the stored bytes of each file nothing else still holds. No Undo.", danger: "high", mcpTier: 3 },
};
