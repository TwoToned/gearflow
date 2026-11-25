import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { callerMayRead, requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { listProjectQuotes } from "./lib/quoteState";

/**
 * Reads behind the job's Files section (UX Phase 10, spec §8c). Both are BOUNDED and
 * org-checked row by row (`by_cuid` and the project indexes are GLOBAL), and say
 * `truncated` when a cap bites.
 */
const FILE_CAP = 200;
const SOURCE_CAP = 50;

/** The project, only when it belongs to the caller's org (`by_cuid` is global). */
async function projectInOrg(ctx: QueryCtx, orgId: string, projectId: string): Promise<boolean> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  return !!project && project.organizationId === orgId;
}

/** A stored file, only when it belongs to the caller's org. */
async function fileInOrg(ctx: QueryCtx, orgId: string, fileId: string) {
  const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  return f && f.organizationId === orgId ? f : null;
}

/** A name only for a MEMBER of this org (the users mirror is global). */
async function memberName(ctx: QueryCtx, orgId: string, userId: string): Promise<string | null> {
  const member = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId)).first();
  if (!member) return null;
  const user = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", userId)).first();
  return user?.name ?? null;
}

/** One Files-list row: the media row joined to its stored file and uploader name. */
function fileRow(
  m: { id: string; fileId: string; type?: string; displayName?: string; sortOrder?: number; createdAt?: number },
  f: { id: string; fileName: string; fileSize: number; mimeType: string; url: string; thumbnailUrl?: string; createdAt?: number },
  uploadedByName: string | null,
) {
  return {
    id: m.id,
    fileId: m.fileId,
    type: m.type ?? "OTHER",
    displayName: m.displayName ?? null,
    sortOrder: m.sortOrder ?? 0,
    addedAt: m.createdAt ?? f.createdAt ?? null,
    uploadedByName,
    file: { id: f.id, fileName: f.fileName, fileSize: f.fileSize, mimeType: f.mimeType, url: f.url, thumbnailUrl: f.thumbnailUrl ?? null },
  };
}

/** The job's own files with who uploaded each and when (the Files list). */
export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    if (!(await projectInOrg(ctx, orgId, projectId))) return { files: [], truncated: false };

    const rows = (await ctx.db.query("projectMedia").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(FILE_CAP + 1)).filter(
      (r) => r.organizationId === orgId,
    );
    const names = new Map<string, string | null>();
    const files = [];
    for (const m of rows.slice(0, FILE_CAP)) {
      const f = await fileInOrg(ctx, orgId, m.fileId);
      if (!f) continue; // a file-less row is dropped, as the old reconstruction did
      if (!names.has(f.uploadedById)) names.set(f.uploadedById, await memberName(ctx, orgId, f.uploadedById));
      files.push(fileRow(m, f, names.get(f.uploadedById) ?? null));
    }
    files.sort((a, b) => a.sortOrder - b.sortOrder);
    return { files, truncated: rows.length > FILE_CAP };
  },
});

interface OtherFile {
  key: string;
  origin: string;
  name: string;
  /** Opens the file: the STORED document route for a quote / invoice, never a live render. */
  href: string;
}
interface Source {
  items: OtherFile[];
  truncated: boolean;
}

/** The sent quote and issued invoice PDFs: stored bytes, a route that never re-renders. */
async function financeFiles(ctx: QueryCtx, orgId: string, projectId: string): Promise<Source> {
  const items: OtherFile[] = [];
  const quotes = await listProjectQuotes(ctx, orgId, projectId);
  for (const q of quotes.slice(0, SOURCE_CAP)) {
    if (q.pdfFileId) items.push({ key: `quote-${q.id}`, origin: "Quote", name: `Quote v${q.version}`, href: `/api/finance/quote/${q.id}/pdf` });
  }
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
    .take(SOURCE_CAP + 1);
  for (const i of invoices.slice(0, SOURCE_CAP)) {
    if (i.pdfFileId) items.push({ key: `invoice-${i.id}`, origin: "Invoice", name: i.invoiceNumber ?? "Invoice", href: `/api/finance/invoice/${i.id}/pdf` });
  }
  return { items, truncated: invoices.length > SOURCE_CAP };
}

/** Sub-hire order attachments. */
async function subHireFiles(ctx: QueryCtx, orgId: string, projectId: string): Promise<Source> {
  const items: OtherFile[] = [];
  const orders = (await ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(SOURCE_CAP + 1)).filter(
    (o) => o.organizationId === orgId,
  );
  for (const o of orders.slice(0, SOURCE_CAP)) {
    const media = (await ctx.db.query("subHireMedia").withIndex("by_subHireId", (q) => q.eq("subHireId", o.id)).take(SOURCE_CAP)).filter((m) => m.organizationId === orgId);
    for (const m of media) {
      const f = await fileInOrg(ctx, orgId, m.fileId);
      if (f) items.push({ key: `subhire-${m.id}`, origin: `Sub-hire ${o.orderNumber}`, name: m.displayName ?? f.fileName, href: f.url });
    }
  }
  return { items, truncated: orders.length > SOURCE_CAP };
}

/** Incident (maintenance record) photos. */
async function incidentFiles(ctx: QueryCtx, orgId: string, projectId: string): Promise<Source> {
  const items: OtherFile[] = [];
  const records = (await ctx.db.query("maintenanceRecords").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(SOURCE_CAP + 1)).filter(
    (r) => r.organizationId === orgId,
  );
  for (const r of records.slice(0, SOURCE_CAP)) {
    for (const fileId of r.photos ?? []) {
      const f = await fileInOrg(ctx, orgId, fileId);
      if (f) items.push({ key: `incident-${r.id}-${f.id}`, origin: "Incident", name: f.fileName, href: f.url });
    }
  }
  return { items, truncated: records.length > SOURCE_CAP };
}

/**
 * "Also on this job": the read-only list of files that live on other tabs: the sent
 * quote and issued invoice PDFs (stored bytes, `invoice:read`), sub-hire attachments
 * (`subHire:read`) and incident photos (`maintenance:read`). It moves nothing and
 * lists a source only when the caller may read it. Each source is capped.
 */
export const alsoOnJob = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    if (!(await projectInOrg(ctx, orgId, projectId))) return { items: [] as OtherFile[], truncated: false };
    const sources: [string, (c: QueryCtx, o: string, p: string) => Promise<Source>][] = [
      ["invoice", financeFiles],
      ["subHire", subHireFiles],
      ["maintenance", incidentFiles],
    ];
    const items: OtherFile[] = [];
    let truncated = false;
    for (const [resource, load] of sources) {
      if (!(await callerMayRead(ctx, orgId, resource as Parameters<typeof callerMayRead>[2]))) continue;
      const s = await load(ctx, orgId, projectId);
      items.push(...s.items);
      truncated ||= s.truncated;
    }
    return { items, truncated };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: { summary: "A job's own files with who uploaded each and when (bounded).", danger: "low", mcpTier: 3 },
  alsoOnJob: { summary: "Read-only list of the job's files that live on other tabs: quote and invoice PDFs, sub-hire attachments, incident photos (each only if the caller may read it).", danger: "low", mcpTier: 3 },
};
