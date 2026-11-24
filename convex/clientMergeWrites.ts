import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, requireOrgReadFor, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { collectCapped } from "./lib/pagination";
import { assertWithinUndoWindow } from "./lib/undoWindow";
import { MAX_TAGS } from "./lib/tagLimits";

/**
 * Client MERGE and its exact Undo (UX Phase 13, D73). No schema change: the loser is
 * archived (`isActive:false`) and "merged into" is read back from the forward audit row.
 *
 * What moves (each set read through a GLOBAL index and org-filtered per row; every id is
 * captured in the forward audit row, which is what Undo reads, never the caller):
 * projects, their `projectVersions` snapshots (a plan field `clientId` that Make live
 * projects BACK onto the project, so skipping it would silently revert the job), invoices,
 * contacts (never primary: the survivor's primary stands), media (a file already on the
 * survivor is skipped) and work-item links. NOT moved: activityEvents, WooCommerce / Xero
 * logs, activity-log rows and stored PDFs (history), and neither client's Xero mapping.
 */
export const MERGE_MAX_ROWS = 1000;
const KIND = "clientMerge";

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const agentOps: AgentOpsAnnotations = {
  mergeClientsNative: { danger: "high" },
  undoClientMergeNative: { danger: "high" },
  mergePreview: { summary: "Counts and a bounded named list of what merging one client into another would move.", danger: "low", mcpTier: 3 },
  mergedInto: { summary: "The client a merged-away (archived) client was merged into, if any.", danger: "low", mcpTier: 3 },
};

interface MoveSets {
  projects: Doc<"projects">[];
  versions: Doc<"projectVersions">[];
  invoices: Doc<"invoices">[];
  contacts: Doc<"clientContacts">[];
  media: Doc<"clientMedia">[];
  links: Doc<"workItemLinks">[];
  skippedMedia: number;
}

const inOrg = <R extends { organizationId?: string }>(rows: R[], orgId: string) => rows.filter((r) => r.organizationId === orgId);

async function loadClientInOrg(ctx: QueryCtx | MutationCtx, id: string, orgId: string): Promise<Doc<"clients">> {
  const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!c || c.organizationId !== orgId) throw new ConvexError("Client not found.");
  return c;
}

/** Everything that would move, bounded: more than MERGE_MAX_ROWS in any set refuses before any write. */
async function collectMoves(ctx: QueryCtx | MutationCtx, orgId: string, loserId: string, survivorId: string): Promise<MoveSets> {
  const cap = MERGE_MAX_ROWS;
  const [projects, invoices, contacts, media, links, survivorMedia] = await Promise.all([
    collectCapped(ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", loserId)), cap),
    collectCapped(ctx.db.query("invoices").withIndex("by_clientId", (q) => q.eq("clientId", loserId)), cap),
    collectCapped(ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", loserId)), cap),
    collectCapped(ctx.db.query("clientMedia").withIndex("by_clientId", (q) => q.eq("clientId", loserId)), cap),
    collectCapped(ctx.db.query("workItemLinks").withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "client").eq("entityId", loserId)), cap),
    collectCapped(ctx.db.query("clientMedia").withIndex("by_clientId", (q) => q.eq("clientId", survivorId)), cap),
  ]);
  const truncated = [projects, invoices, contacts, media, links].some((s) => s.truncated);
  if (truncated) throw new ConvexError(`Too many records to merge in one go (over ${cap} of one kind). Archive instead, or ask for help.`);
  const myProjects = inOrg(projects.rows, orgId);
  const versions: Doc<"projectVersions">[] = [];
  for (const p of myProjects) {
    const vs = await collectCapped(ctx.db.query("projectVersions").withIndex("by_projectId_number", (q) => q.eq("projectId", p.id)), cap);
    versions.push(...inOrg(vs.rows, orgId).filter((x) => x.clientId === loserId));
  }
  const have = new Set(inOrg(survivorMedia.rows, orgId).map((m) => m.fileId));
  const myMedia = inOrg(media.rows, orgId);
  const movable = myMedia.filter((m) => !have.has(m.fileId));
  const total = myProjects.length + versions.length + invoices.rows.length + contacts.rows.length + movable.length + links.rows.length;
  if (total > cap) throw new ConvexError(`Too many records to merge in one go (${total}). Archive instead, or ask for help.`);
  return {
    projects: myProjects, versions, invoices: inOrg(invoices.rows, orgId), contacts: inOrg(contacts.rows, orgId),
    media: movable, links: inOrg(links.rows, orgId), skippedMedia: myMedia.length - movable.length,
  };
}

const counts = (m: MoveSets) => ({ projects: m.projects.length, versions: m.versions.length, invoices: m.invoices.length, contacts: m.contacts.length, media: m.media.length, links: m.links.length, skippedMedia: m.skippedMedia });

function assertMergeable(survivor: Doc<"clients">, loser: Doc<"clients">) {
  if (survivor.id === loser.id) throw new ConvexError("Pick two different clients.");
  if ((loser.isActive ?? true) === false) throw new ConvexError("That client is already archived or merged.");
  if ((survivor.isActive ?? true) === false) throw new ConvexError("Merge into an active client.");
}

/** What a merge would move: counts plus the first 50 names (jobs and invoices). Read-only, fails open in the UI. */
export const mergePreview = query({
  args: { orgId: v.string(), survivorId: v.string(), loserId: v.string() },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "client");
    const [survivor, loser] = [await loadClientInOrg(ctx, a.survivorId, a.orgId), await loadClientInOrg(ctx, a.loserId, a.orgId)];
    assertMergeable(survivor, loser);
    const m = await collectMoves(ctx, a.orgId, a.loserId, a.survivorId);
    return {
      survivor: { id: survivor.id, name: survivor.name },
      loser: { id: loser.id, name: loser.name },
      counts: counts(m),
      jobs: m.projects.slice(0, 50).map((p) => ({ id: p.id, projectNumber: p.projectNumber, name: p.name })),
      invoices: m.invoices.slice(0, 50).map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber ?? null })),
      contacts: m.contacts.slice(0, 50).map((c) => ({ id: c.id, name: c.name ?? null })),
    };
  },
});

function unionTags(a: string[] | undefined, b: string[] | undefined): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, MAX_TAGS);
}

export const mergeClientsNative = mutation({
  returns: v.object({ counts: v.object({ projects: v.number(), versions: v.number(), invoices: v.number(), contacts: v.number(), media: v.number(), links: v.number(), skippedMedia: v.number() }), auditId: v.string() }),
  args: { orgId: v.string(), survivorId: v.string(), loserId: v.string(), auditId: v.string(), receivedAuditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "client", "update");
    await requireOrgPermission(ctx, a.orgId, "invoice", "update"); // it re-points invoices
    const actor = await resolveActor(ctx, a.actor);
    const survivor = await loadClientInOrg(ctx, a.survivorId, a.orgId);
    const loser = await loadClientInOrg(ctx, a.loserId, a.orgId);
    assertMergeable(survivor, loser);
    const m = await collectMoves(ctx, a.orgId, a.loserId, a.survivorId);

    for (const p of m.projects) await ctx.db.patch(p._id, { clientId: a.survivorId, updatedAt: a.now });
    for (const x of m.versions) await ctx.db.patch(x._id, { clientId: a.survivorId });
    for (const i of m.invoices) await ctx.db.patch(i._id, { clientId: a.survivorId, updatedAt: a.now });
    for (const c of m.contacts) await ctx.db.patch(c._id, { clientId: a.survivorId, isPrimary: false, updatedAt: a.now });
    for (const x of m.media) await ctx.db.patch(x._id, { clientId: a.survivorId });
    for (const l of m.links) await ctx.db.patch(l._id, { entityId: a.survivorId });
    const tagsBefore = survivor.tags ?? [];
    const tagsAfter = unionTags(survivor.tags, loser.tags);
    await ctx.db.patch(survivor._id, { tags: tagsAfter, updatedAt: a.now });
    await ctx.db.patch(loser._id, { isActive: false, updatedAt: a.now });

    const details = {
      kind: KIND, survivorId: a.survivorId, loserId: a.loserId, serverSavedAt: Date.now(), survivorTagsBefore: tagsBefore, survivorTagsAfter: tagsAfter,
      moved: {
        projects: m.projects.map((p) => p.id), projectVersions: m.versions.map((x) => x.id), invoices: m.invoices.map((i) => i.id),
        clientContacts: m.contacts.map((c) => ({ id: c.id, wasPrimary: c.isPrimary ?? false, sortOrder: c.sortOrder ?? null })),
        clientMedia: m.media.map((x) => x.id), workItemLinks: m.links.map((l) => l.id),
      },
    };
    const base = { organizationId: a.orgId, userId: actor.userId, userName: actor.userName, createdAt: a.now };
    await writeActivityLog(ctx, { ...base, id: a.auditId, action: "MERGE", entityType: "client", entityId: loser.id, entityName: loser.name, summary: `Merged client ${loser.name} into ${survivor.name}`, details });
    await writeActivityLog(ctx, { ...base, id: a.receivedAuditId, action: "MERGE_RECEIVED", entityType: "client", entityId: survivor.id, entityName: survivor.name, summary: `Merged ${loser.name} into this client`, details: { kind: `${KIND}Received`, loserId: loser.id, forwardAuditId: a.auditId } });
    return { counts: counts(m), auditId: a.auditId };
  },
});

interface MergeSnapshot {
  kind: string; survivorId: string; loserId: string; serverSavedAt: number; survivorTagsBefore: string[]; survivorTagsAfter: string[];
  moved: { projects: string[]; projectVersions: string[]; invoices: string[]; clientContacts: { id: string; wasPrimary: boolean; sortOrder: number | null }[]; clientMedia: string[]; workItemLinks: string[] };
}

async function byCuid<T extends "projects" | "projectVersions" | "invoices" | "clientContacts" | "clientMedia" | "workItemLinks">(ctx: MutationCtx, table: T, ids: string[], orgId: string): Promise<Doc<T>[]> {
  const out: Doc<T>[] = [];
  for (const id of ids) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (await ctx.db.query(table).withIndex("by_cuid" as any, (q: any) => q.eq("id", id)).first()) as Doc<T> | null;
    if (row && (row as { organizationId?: string }).organizationId === orgId) out.push(row);
  }
  return out;
}

async function loadUndoableMerge(ctx: MutationCtx, orgId: string, forwardAuditId: string, userId: string) {
  const forward = await ctx.db.query("activityLogs").withIndex("by_cuid", (q) => q.eq("id", forwardAuditId)).first();
  const d = forward?.details as MergeSnapshot | undefined;
  if (!forward || forward.organizationId !== orgId || d?.kind !== KIND) throw new ConvexError("That merge was not found.");
  if (forward.userId !== userId) throw new ConvexError("Only the person who merged can undo it.");
  assertWithinUndoWindow(d.serverSavedAt, Date.now(), "change");
  const prior = await collectCapped(ctx.db.query("activityLogs").withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "client").eq("entityId", d.loserId)), 200);
  if (prior.rows.some((r) => r.action === "UNDO" && (r.details as { undoOf?: string } | undefined)?.undoOf === forwardAuditId)) throw new ConvexError("That merge was already undone.");
  const loser = await loadClientInOrg(ctx, d.loserId, orgId);
  if ((loser.isActive ?? true) !== false) throw new ConvexError("The merged client was reactivated since, so this can't be undone.");
  return { forward, d, loser };
}

/**
 * The EXACT reverse of one merge, ids only. Reverses exactly the ids the forward row
 * recorded, and only those still where the merge left them (a row the user re-pointed
 * since stays and is NAMED in the result); rows created for the survivor afterwards were
 * never recorded so are never touched. Refuses outside the 10-minute server window, for
 * another user, a second time, or once the loser was reactivated. Deletes nothing.
 */
export const undoClientMergeNative = mutation({
  returns: v.object({ restored: v.number(), left: v.array(v.object({ table: v.string(), id: v.string() })) }),
  args: { orgId: v.string(), forwardAuditId: v.string(), auditId: v.string(), now: v.number(), actor: actorValidator },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "client", "update");
    await requireOrgPermission(ctx, a.orgId, "invoice", "update");
    const actor = await resolveActor(ctx, a.actor);
    const { forward, d, loser } = await loadUndoableMerge(ctx, a.orgId, a.forwardAuditId, actor.userId);
    const left: { table: string; id: string }[] = [];
    let restored = 0;
    const back = async <T extends "projects" | "projectVersions" | "invoices" | "clientMedia">(table: T, ids: string[], extra: (row: Doc<T>) => object = () => ({})) => {
      for (const row of await byCuid(ctx, table, ids, a.orgId)) {
        if ((row as { clientId?: string }).clientId !== d.survivorId) { left.push({ table, id: (row as unknown as { id: string }).id }); continue; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.patch(row._id as any, { clientId: d.loserId, ...extra(row) } as any);
        restored++;
      }
    };
    await back("projects", d.moved.projects, () => ({ updatedAt: a.now }));
    await back("projectVersions", d.moved.projectVersions);
    await back("invoices", d.moved.invoices, () => ({ updatedAt: a.now }));
    await back("clientMedia", d.moved.clientMedia);
    const contactInfo = new Map(d.moved.clientContacts.map((c) => [c.id, c]));
    for (const c of await byCuid(ctx, "clientContacts", d.moved.clientContacts.map((x) => x.id), a.orgId)) {
      if (c.clientId !== d.survivorId) { left.push({ table: "clientContacts", id: c.id }); continue; }
      const was = contactInfo.get(c.id)!;
      await ctx.db.patch(c._id, { clientId: d.loserId, isPrimary: was.wasPrimary, sortOrder: was.sortOrder ?? undefined, updatedAt: a.now });
      restored++;
    }
    for (const l of await byCuid(ctx, "workItemLinks", d.moved.workItemLinks, a.orgId)) {
      if (l.entityId !== d.survivorId) { left.push({ table: "workItemLinks", id: l.id }); continue; }
      await ctx.db.patch(l._id, { entityId: d.loserId });
      restored++;
    }
    const survivor = await loadClientInOrg(ctx, d.survivorId, a.orgId);
    const sameTags = JSON.stringify(survivor.tags ?? []) === JSON.stringify(d.survivorTagsAfter);
    if (sameTags) await ctx.db.patch(survivor._id, { tags: d.survivorTagsBefore, updatedAt: a.now });
    else left.push({ table: "clients", id: survivor.id });
    await ctx.db.patch(loser._id, { isActive: true, updatedAt: a.now });
    await writeActivityLog(ctx, {
      id: a.auditId, organizationId: a.orgId, action: "UNDO", entityType: "client", entityId: loser.id, entityName: loser.name,
      userId: actor.userId, userName: actor.userName, summary: `Undid the merge of ${loser.name}`, details: { undoOf: forward.id, left }, createdAt: a.now,
    });
    return { restored, left };
  },
});

/** The client a merged-away client was merged into (from the forward audit row), or null. */
export const mergedInto = query({
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await requireOrgReadFor(ctx, orgId, "client");
    const client = await loadClientInOrg(ctx, id, orgId);
    if ((client.isActive ?? true) !== false) return null;
    const rows = (await collectCapped(ctx.db.query("activityLogs").withIndex("by_organizationId_entityType_entityId", (q) => q.eq("organizationId", orgId).eq("entityType", "client").eq("entityId", id)), 200)).rows;
    const undone = new Set(rows.filter((r) => r.action === "UNDO").map((r) => (r.details as { undoOf?: string } | undefined)?.undoOf));
    const merge = rows.filter((r) => r.action === "MERGE" && !undone.has(r.id)).sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))[0];
    const survivorId = (merge?.details as MergeSnapshot | undefined)?.survivorId;
    if (!survivorId) return null;
    const survivor = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", survivorId)).first();
    return survivor && survivor.organizationId === orgId ? { id: survivor.id, name: survivor.name, forwardAuditId: merge.id } : null;
  },
});
