// @vitest-environment node
//
// #1080/#1097 backfill: best-effort stamp of `invoices.sourceRevision` from
// the project's current `revision` onto every pre-#1097 invoice missing one.
// See convex/backfillInvoiceSourceRevision.ts.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

function project(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, organizationId: ORG, projectNumber: `P-${id}`, name: "Gig", status: "CONFIRMED" as const,
    isTemplate: false, revision: 1, createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

function invoice(id: string, projectId: string, extra: Record<string, unknown> = {}) {
  return {
    id, organizationId: ORG, projectId, clientId: "c1", kind: "FULL" as const, status: "DRAFT" as const,
    subtotal: 100, taxAmount: 10, total: 110, createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

async function runBackfill(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let updated = 0;
  let skippedNoProject = 0;
  for (;;) {
    const r: { scanned: number; updated: number; skippedNoProject: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillInvoiceSourceRevision.backfillInvoiceSourceRevisionPage, { cursor, apply });
    scanned += r.scanned;
    updated += r.updated;
    skippedNoProject += r.skippedNoProject;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, updated, skippedNoProject };
}

async function verify(t: T) {
  let cursor: string | null = null;
  let totalInvoices = 0;
  let invoicesMissingSourceRevision = 0;
  for (;;) {
    const r: { totalInvoices: number; invoicesMissingSourceRevision: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).query(api.backfillInvoiceSourceRevision.verifyInvoiceSourceRevision, { cursor });
    totalInvoices += r.totalInvoices;
    invoicesMissingSourceRevision += r.invoicesMissingSourceRevision;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { totalInvoices, invoicesMissingSourceRevision };
}

const invById = (t: T, id: string) => t.run((ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillInvoiceSourceRevision — best-effort stamp from the project's current revision", () => {
  test("stamps sourceRevision from the project's current revision", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { revision: 3 }));
      await ctx.db.insert("invoices", invoice("i1", "p1"));
    });

    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(1);
    expect(updated).toBe(1);
    expect((await invById(t, "i1"))?.sourceRevision).toBe(3);
  });

  test("defaults to 1 when the project's revision itself is absent", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { revision: undefined }));
      await ctx.db.insert("invoices", invoice("i1", "p1"));
    });

    await runBackfill(t);
    expect((await invById(t, "i1"))?.sourceRevision).toBe(1);
  });

  test("an invoice that already has sourceRevision is skipped", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { revision: 5 }));
      await ctx.db.insert("invoices", invoice("i1", "p1", { sourceRevision: 2 }));
    });

    const { scanned, updated } = await runBackfill(t);
    expect(scanned).toBe(0);
    expect(updated).toBe(0);
    expect((await invById(t, "i1"))?.sourceRevision).toBe(2); // untouched
  });

  test("dry-run scans but writes nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { revision: 4 }));
      await ctx.db.insert("invoices", invoice("i1", "p1"));
    });

    const { scanned, updated } = await runBackfill(t, false);
    expect(scanned).toBe(1);
    expect(updated).toBe(0);
    expect((await invById(t, "i1"))?.sourceRevision).toBeUndefined();
  });

  test("re-running the backfill stamps nothing new", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1"));
      await ctx.db.insert("invoices", invoice("i1", "p1"));
    });
    expect((await runBackfill(t)).updated).toBe(1);
    expect((await runBackfill(t)).updated).toBe(0);
  });

  test("verifyInvoiceSourceRevision reports zero un-migrated invoices after a full apply run", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", project("p1", { revision: 1 }));
      await ctx.db.insert("projects", project("p2", { revision: 5 }));
      await ctx.db.insert("invoices", invoice("i1", "p1"));
      await ctx.db.insert("invoices", invoice("i2", "p2"));
    });

    expect(await verify(t)).toEqual({ totalInvoices: 2, invoicesMissingSourceRevision: 2 });
    await runBackfill(t);
    expect(await verify(t)).toEqual({ totalInvoices: 2, invoicesMissingSourceRevision: 0 });
  });
});
