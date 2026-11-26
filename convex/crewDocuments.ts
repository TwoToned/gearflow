import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { collectCapped } from "./lib/pagination";
import { canSeeCrewDocuments } from "./lib/crewDocumentAccess";
import { MAX_CREW_DOCUMENTS } from "./lib/crewDocumentCore";

/**
 * Crew document reads (UX Phase 13, D72). Identity and licence material, so every read decides
 * with THE one rule (`canSeeCrewDocuments` -> `crewDocumentsVisible`): the member themself or
 * `crew:update`, on a USER session. A caller who fails it gets `null` (the tab is absent), never
 * an empty list that would confirm the member exists. API keys and agents are denied outright
 * (`agentAccess: "denied"`); the download is service-only and served by the gated route
 * `/api/crew/documents/[id]/file`, which re-applies the same rule. `by_crewMemberId` is global:
 * every row is org-checked.
 */

export const agentOps: AgentOpsAnnotations = {
  listForMember: { agentAccess: "denied", reason: "Crew documents are identity and licence material: visible only to the member themself or crew:update on a user session (owner ruling B2), never an API key." },
  getForDownload: { agentAccess: "denied", reason: "Service-only: the gated download route decides for the real caller." },
};

async function loadMember(ctx: QueryCtx, orgId: string, crewMemberId: string) {
  const m = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", crewMemberId)).first();
  return m && m.organizationId === orgId ? m : null;
}

async function memberDocuments(ctx: QueryCtx, orgId: string, crewMemberId: string) {
  const rows = await collectCapped(ctx.db.query("crewDocuments").withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId)), MAX_CREW_DOCUMENTS);
  return rows.rows.filter((d) => d.organizationId === orgId);
}

/** One document as the list shows it: file METADATA and the gated route's path, never a storage key or URL. */
async function documentView(ctx: QueryCtx, orgId: string, d: Doc<"crewDocuments">) {
  const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", d.fileId)).first();
  const own = file && file.organizationId === orgId ? file : null;
  return {
    id: d.id, kind: d.kind, name: d.name ?? own?.fileName ?? "Document", expiresAt: d.expiresAt ?? null, createdAt: d.createdAt,
    file: own ? { fileName: own.fileName, fileSize: own.fileSize, mimeType: own.mimeType, downloadPath: `/api/crew/documents/${d.id}/file` } : null,
  };
}

/** The member's documents with their file metadata (never a storage key or URL), or `null` when the caller may not see them. */
export const listForMember = query({
  args: { orgId: v.string(), crewMemberId: v.string() },
  handler: async (ctx, { orgId, crewMemberId }) => {
    const member = await loadMember(ctx, orgId, crewMemberId);
    if (!member || !(await canSeeCrewDocuments(ctx, orgId, member))) return null;
    const out = [];
    for (const d of await memberDocuments(ctx, orgId, crewMemberId)) out.push(await documentView(ctx, orgId, d));
    return out.sort((a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY) || b.createdAt - a.createdAt);
  },
});

/**
 * Service-only: what the download route needs to stream one document. The ROUTE decides for the
 * real caller with `crewDocumentsVisible` (it has the session and role; a service read always
 * passes `canSeeCrewDocuments` otherwise). Returns `null` for a foreign or missing document.
 */
export const getForDownload = query({
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewDocuments").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) return null;
    const member = await loadMember(ctx, orgId, doc.crewMemberId);
    const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", doc.fileId)).first();
    if (!member || !file || file.organizationId !== orgId) return null;
    const url = await ctx.storage.getUrl(file.storageKey as Id<"_storage">);
    if (!url) return null;
    return { url, memberUserId: member.userId ?? null, fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize };
  },
});
