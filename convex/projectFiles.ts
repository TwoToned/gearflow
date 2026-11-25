import { v } from "convex/values";
import { query } from "./_generated/server";
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

/** The job's own files with who uploaded each and when (the Files list). */
export const listForProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgReadFor(ctx, orgId, "project");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return { files: [], truncated: false };

    const rows = (await ctx.db.query("projectMedia").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(FILE_CAP + 1)).filter(
      (r) => r.organizationId === orgId,
    );
    const page = rows.slice(0, FILE_CAP);
    const names = new Map<string, string | null>();
    const files = [];
    for (const m of page) {
      const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).first();
      if (!f || f.organizationId !== orgId) continue; // a file-less row is dropped, as the old reconstruction did
      if (!names.has(f.uploadedById)) {
        // The users mirror is global: expose a name only for a MEMBER of this org.
        const member = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", f.uploadedById)).first();
        const user = member ? await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", f.uploadedById)).first() : null;
        names.set(f.uploadedById, user?.name ?? null);
      }
      files.push({
        id: m.id,
        fileId: m.fileId,
        type: m.type ?? "OTHER",
        displayName: m.displayName ?? null,
        sortOrder: m.sortOrder ?? 0,
        addedAt: m.createdAt ?? f.createdAt ?? null,
        uploadedByName: names.get(f.uploadedById) ?? null,
        file: { id: f.id, fileName: f.fileName, fileSize: f.fileSize, mimeType: f.mimeType, url: f.url, thumbnailUrl: f.thumbnailUrl ?? null },
      });
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
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return { items: [] as OtherFile[], truncated: false };
    const items: OtherFile[] = [];
    let truncated = false;

    if (await callerMayRead(ctx, orgId, "invoice")) {
      const quotes = await listProjectQuotes(ctx, orgId, projectId);
      for (const q of quotes.slice(0, SOURCE_CAP)) {
        if (q.pdfFileId) items.push({ key: `quote-${q.id}`, origin: "Quote", name: `Quote v${q.version}`, href: `/api/finance/quote/${q.id}/pdf` });
      }
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_organizationId_projectId", (q) => q.eq("organizationId", orgId).eq("projectId", projectId))
        .take(SOURCE_CAP + 1);
      truncated ||= invoices.length > SOURCE_CAP;
      for (const i of invoices.slice(0, SOURCE_CAP)) {
        if (i.pdfFileId) items.push({ key: `invoice-${i.id}`, origin: "Invoice", name: i.invoiceNumber ?? "Invoice", href: `/api/finance/invoice/${i.id}/pdf` });
      }
    }

    if (await callerMayRead(ctx, orgId, "subHire")) {
      const orders = (await ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(SOURCE_CAP + 1)).filter(
        (o) => o.organizationId === orgId,
      );
      truncated ||= orders.length > SOURCE_CAP;
      for (const o of orders.slice(0, SOURCE_CAP)) {
        const media = (await ctx.db.query("subHireMedia").withIndex("by_subHireId", (q) => q.eq("subHireId", o.id)).take(SOURCE_CAP)).filter((m) => m.organizationId === orgId);
        for (const m of media) {
          const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).first();
          if (f && f.organizationId === orgId) items.push({ key: `subhire-${m.id}`, origin: `Sub-hire ${o.orderNumber}`, name: m.displayName ?? f.fileName, href: f.url });
        }
      }
    }

    if (await callerMayRead(ctx, orgId, "maintenance")) {
      const records = (await ctx.db.query("maintenanceRecords").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(SOURCE_CAP + 1)).filter(
        (r) => r.organizationId === orgId,
      );
      truncated ||= records.length > SOURCE_CAP;
      for (const r of records.slice(0, SOURCE_CAP)) {
        for (const fileId of r.photos ?? []) {
          const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
          if (f && f.organizationId === orgId) items.push({ key: `incident-${r.id}-${f.id}`, origin: "Incident", name: f.fileName, href: f.url });
        }
      }
    }
    return { items, truncated };
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: { summary: "A job's own files with who uploaded each and when (bounded).", danger: "low", mcpTier: 3 },
  alsoOnJob: { summary: "Read-only list of the job's files that live on other tabs: quote and invoice PDFs, sub-hire attachments, incident photos (each only if the caller may read it).", danger: "low", mcpTier: 3 },
};
