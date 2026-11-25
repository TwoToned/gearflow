import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import { writeActivityLog } from "./lib/audit";
import { collectCapped } from "./lib/pagination";
import { deleteStoredFile } from "./lib/deleteStoredFile";
import { diffFields, recordFieldEdit, undoFieldEdit } from "./lib/fieldEditUndo";
import { claimRowOpUndo, recordRowOp } from "./lib/rowOpUndo";
import { requireCrewDocumentWriter } from "./lib/crewDocumentAccess";
import { CREW_DOCUMENTS_FOLDER, CREW_UPLOAD_MAX_AGE_MS, MAX_CREW_DOCUMENTS, crewDocumentKind } from "./lib/crewDocumentCore";

/**
 * Crew document writes (UX Phase 13, D72). Gate: `crew:update` on a USER session (a member may
 * read their own documents but never writes them; an agent is refused). Standard shape: 4 guards
 * + per-row org re-check (the member, the document and the file are all fetched by the GLOBAL
 * `by_cuid` index) + atomic audit.
 *
 * The FILE must be one this caller uploaded in the last 10 minutes, in this org, into the
 * reserved `crew-documents` stored-file folder, and not already attached to another document, so
 * nobody can attach someone else's file (or an invoice PDF) as a crew document.
 *
 * UNDO is exact and server-side (ids only; author + window + once + still-as-left):
 *  - an ADD is undone by detaching the row; the uploaded file STAYS (an Undo never deletes a file);
 *  - an EDIT (name, kind, expiry) is undone by the shared per-field compare-and-set;
 *  - REMOVE deletes the stored bytes for good, so it is a confirmed verb with NO Undo.
 * Add / remove audit rows fold under the crew member (History); an edit's row is under the
 * document itself, so its Undo cannot be pointed at a different document.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const MEMBER_ENTITY = "crew_member";

async function guards(ctx: MutationCtx, orgId: string) {
  await assertWritesEnabled(ctx, "crew");
  await enforceBrowserWriteLimit(ctx);
  await requireCrewDocumentWriter(ctx, orgId);
}

async function loadMember(ctx: MutationCtx, orgId: string, id: string) {
  const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!m || m.organizationId !== orgId) throw new ConvexError("Crew member not found");
  return m;
}

async function loadDocument(ctx: MutationCtx, orgId: string, crewMemberId: string, id: string) {
  const d = await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!d || d.organizationId !== orgId || d.crewMemberId !== crewMemberId) throw new ConvexError("That document is not on this crew member.");
  return d;
}

const memberName = (m: { firstName: string; lastName: string }) => `${m.firstName} ${m.lastName}`;
const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

/** The file is this caller's own, fresh upload into the crew-documents folder, and attached nowhere else. */
async function assertFreshCrewUpload(ctx: MutationCtx, a: { orgId: string; userId: string; fileId: string }): Promise<void> {
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", a.fileId)).first();
  if (!file || file.organizationId !== a.orgId) throw new ConvexError("File not found");
  if (file.uploadedById !== a.userId) throw new ConvexError("That file was not uploaded by you.");
  if (Date.now() - file._creationTime > CREW_UPLOAD_MAX_AGE_MS) throw new ConvexError("That upload is too old: upload the file again.");
  const stored = await ctx.db.query("storedFiles").withIndex("by_storageId", (q) => q.eq("storageId", file.storageKey)).unique();
  if (!stored || stored.organizationId !== a.orgId || stored.folder !== CREW_DOCUMENTS_FOLDER) throw new ConvexError("That file was not uploaded as a crew document.");
  const used = await ctx.db.query("crewDocuments").withIndex("by_fileId", (q) => q.eq("fileId", a.fileId)).first();
  if (used) throw new ConvexError("That file is already attached to a document.");
}

const DOC_FIELDS = ["name", "kind", "expiresAt"] as const;

export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(), orgId: v.string(), crewMemberId: v.string(), fileId: v.string(), kind: crewDocumentKind,
    name: v.optional(v.string()), expiresAt: v.optional(v.number()), now: v.number(), actor: actorValidator, auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    assertStrLen(a.name, "name", { max: 200 });
    const member = await loadMember(ctx, a.orgId, a.crewMemberId);
    await assertFreshCrewUpload(ctx, { orgId: a.orgId, userId: actor.userId, fileId: a.fileId });
    if (await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", a.id)).first()) throw new ConvexError("Crew document already exists");
    const existing = await collectCapped(ctx.db.query("crewDocuments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", a.crewMemberId)), MAX_CREW_DOCUMENTS + 1);
    if (existing.rows.filter((d) => d.organizationId === a.orgId).length >= MAX_CREW_DOCUMENTS) throw new ConvexError(`A crew member can have at most ${MAX_CREW_DOCUMENTS} documents.`);
    await ctx.db.insert("crewDocuments", {
      id: a.id, organizationId: a.orgId, crewMemberId: a.crewMemberId, fileId: a.fileId, kind: a.kind, name: clean(a.name),
      ...(a.expiresAt != null ? { expiresAt: a.expiresAt } : {}), createdAt: a.now, createdById: actor.userId, updatedAt: a.now,
    });
    await recordRowOp(ctx, {
      orgId: a.orgId, entityType: MEMBER_ENTITY, entityId: a.crewMemberId, entityName: memberName(member), auditId: a.auditId, actor, now: a.now, action: "UPDATE",
      // The audit names the KIND only, never the file or its label (the History tab reads this).
      summary: `Added a ${a.kind.toLowerCase()} document to ${memberName(member)}`, op: { op: "add", table: "crewDocuments", rowId: a.id, snapshot: null },
    });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ changed: v.boolean() }),
  args: {
    orgId: v.string(), crewMemberId: v.string(), documentId: v.string(), kind: crewDocumentKind,
    name: v.optional(v.string()), expiresAt: v.optional(v.number()), now: v.number(), actor: actorValidator, auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    assertStrLen(a.name, "name", { max: 200 });
    const doc = await loadDocument(ctx, a.orgId, a.crewMemberId, a.documentId);
    const next = { name: clean(a.name), kind: a.kind, expiresAt: a.expiresAt };
    const diff = diffFields(doc, { ...doc, ...next }, DOC_FIELDS);
    if (!diff) return { changed: false };
    await ctx.db.patch(doc._id, { ...next, updatedAt: a.now });
    await recordFieldEdit(ctx, { orgId: a.orgId, entityType: "crewDocument", entityId: a.documentId, entityName: "crew document", auditId: a.auditId, actor, now: a.now, diff, summary: "Edited a crew document" });
    return { changed: true };
  },
});

/** Removing a document deletes its stored file for good: confirmed in the UI, no Undo. */
export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), crewMemberId: v.string(), documentId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const member = await loadMember(ctx, a.orgId, a.crewMemberId);
    const doc = await loadDocument(ctx, a.orgId, a.crewMemberId, a.documentId);
    await deleteStoredFile(ctx, doc.fileId, a.orgId);
    await ctx.db.delete(doc._id);
    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "DELETE", entityType: MEMBER_ENTITY, entityId: a.crewMemberId, entityName: memberName(member),
      userId: actor.userId, userName: actor.userName, summary: `Removed a ${doc.kind.toLowerCase()} document from ${memberName(member)}`, createdAt: a.now,
    });
    return { id: a.documentId };
  },
});

/** Undo an ADD: detach the row only if still unedited; the uploaded file STAYS in storage. */
export const undoAddNative = mutation({
  returns: v.object({ restored: v.boolean(), note: v.optional(v.string()) }),
  args: { orgId: v.string(), crewMemberId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const member = await loadMember(ctx, a.orgId, a.crewMemberId);
    const op = await claimRowOpUndo(ctx, { orgId: a.orgId, entityType: MEMBER_ENTITY, entityId: a.crewMemberId, entityName: memberName(member), auditId: a.forwardAuditId, actor, now: a.now, table: "crewDocuments" });
    const row = await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", op.rowId)).first();
    if (!row || row.organizationId !== a.orgId) return { restored: false, note: "The document was already removed." };
    if (row.updatedAt !== row.createdAt) throw new ConvexError({ code: "CHANGED_SINCE", message: "Can't undo: the document was edited since." });
    await ctx.db.delete(row._id);
    return { restored: true };
  },
});

/** The exact Undo of an edit: ids only (the FORWARD `auditId`); refuses as a whole unless still exact. */
export const undoUpdateNative = mutation({
  returns: v.object({ restored: v.array(v.string()) }),
  args: { orgId: v.string(), documentId: v.string(), forwardAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await guards(ctx, a.orgId);
    const actor = await resolveActor(ctx, a.actor);
    const load = async () => {
      const row = await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", a.documentId)).first();
      return row && row.organizationId === a.orgId ? row : null;
    };
    return await undoFieldEdit(ctx, {
      orgId: a.orgId, entityType: "crewDocument", entityId: a.documentId, entityName: "crew document", auditId: a.forwardAuditId, actor, now: a.now, load,
      apply: async (doc, plan) => {
        const patch: Record<string, unknown> = { ...plan.set, updatedAt: a.now };
        for (const f of plan.clear) patch[f] = undefined;
        await ctx.db.patch(doc._id, patch);
      },
    });
  },
});

export const agentOps: AgentOpsAnnotations = {
  addNative: { agentAccess: "denied", reason: "Crew documents are identity and licence material: user sessions with crew:update only, never an API key (owner ruling B2)." },
  updateNative: { agentAccess: "denied", reason: "Crew documents: user sessions with crew:update only (owner ruling B2)." },
  removeNative: { agentAccess: "denied", reason: "Crew documents: user sessions with crew:update only (owner ruling B2)." },
  undoAddNative: { agentAccess: "denied", reason: "Crew documents: user sessions with crew:update only (owner ruling B2)." },
  undoUpdateNative: { agentAccess: "denied", reason: "Crew documents: user sessions with crew:update only (owner ruling B2)." },
};
