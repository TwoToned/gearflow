// @vitest-environment node
//
// convex/financeArtifacts.ts (#987) — the attach-once guarantee and the org
// checks the two artifact routes rest on.
//
// Two properties are load-bearing enough to be machine-checked rather than
// argued: an artifact can NEVER be replaced once attached (which is what makes
// exposing a retry button safe), and every function re-checks the ROW's org
// (`quotes.by_cuid` / `invoices.by_cuid` are GLOBAL indexes and the service
// token authorises nothing about the row — R-8.4.3). These routes are the
// highest-risk new surface in the program.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;

/** The server identity every function here demands (requireService). */
const asService = { subject: "gearflow-service", svc: true };

function makeT() {
  return convexTest(schema, modules);
}

async function seed(t: ReturnType<typeof makeT>, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTED", isTemplate: false, revision: 2, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("quotes", {
      id: "q1", organizationId: orgId, projectId: "p1", version: 2, status: "SENT",
      snapshot: { total: 110 }, sentAt: NOW, quoteDate: NOW, validUntil: NOW + 86_400_000 * 30,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("quotes", {
      id: "q_draft", organizationId: orgId, projectId: "p1", version: 3, status: "DRAFT",
      snapshot: null, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("invoices", {
      id: "inv1", organizationId: orgId, projectId: "p1", clientId: "c1", kind: "FULL",
      status: "ISSUED", invoiceNumber: "INV-2026-0001", issuedAt: NOW,
      subtotal: 100, taxAmount: 10, total: 110, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("invoices", {
      id: "inv_draft", organizationId: orgId, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
      status: "DRAFT", subtotal: 25, taxAmount: 2.5, total: 27.5, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const svc = (t: ReturnType<typeof makeT>) => t.withIdentity(asService);

describe("attachQuoteArtifact", () => {
  test("attaches the storage id to a SENT revision", async () => {
    const t = makeT();
    await seed(t);

    const result = await svc(t).mutation(api.financeArtifacts.attachQuoteArtifact, {
      quoteId: "q1", orgId: ORG, storageId: "storage_1", now: NOW,
    });

    expect(result).toEqual({ attached: true, pdfFileId: "storage_1" });
    const quote = await t.run(async (ctx) =>
      ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first());
    expect(quote?.pdfFileId).toBe("storage_1");
  });

  test("NEVER overwrites an existing artifact — it reports the one already there", async () => {
    const t = makeT();
    await seed(t);
    await svc(t).mutation(api.financeArtifacts.attachQuoteArtifact, {
      quoteId: "q1", orgId: ORG, storageId: "storage_first", now: NOW,
    });

    const second = await svc(t).mutation(api.financeArtifacts.attachQuoteArtifact, {
      quoteId: "q1", orgId: ORG, storageId: "storage_second", now: NOW + 1000,
    });

    expect(second).toEqual({ attached: false, pdfFileId: "storage_first" });
    const quote = await t.run(async (ctx) =>
      ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first());
    expect(quote?.pdfFileId).toBe("storage_first");
  });

  test("refuses a never-sent draft — a draft's only document is the watermarked preview", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      svc(t).mutation(api.financeArtifacts.attachQuoteArtifact, {
        quoteId: "q_draft", orgId: ORG, storageId: "storage_1", now: NOW,
      }),
    ).rejects.toThrow(/sent quote revision/i);
  });

  test("cross-org attach is NOT_FOUND, not a silent write (R-8.4.3)", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      svc(t).mutation(api.financeArtifacts.attachQuoteArtifact, {
        quoteId: "q1", orgId: OTHER, storageId: "storage_evil", now: NOW,
      }),
    ).rejects.toThrow(/not found/i);

    const quote = await t.run(async (ctx) =>
      ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first());
    expect(quote?.pdfFileId).toBeUndefined();
  });

  test("requires the service identity — a plain user session cannot attach", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).mutation(api.financeArtifacts.attachQuoteArtifact, {
        quoteId: "q1", orgId: ORG, storageId: "storage_1", now: NOW,
      }),
    ).rejects.toThrow(/requires the RVLT Flow server/i);
  });
});

describe("attachInvoiceArtifact", () => {
  test("attaches to an ISSUED invoice and never overwrites", async () => {
    const t = makeT();
    await seed(t);

    const first = await svc(t).mutation(api.financeArtifacts.attachInvoiceArtifact, {
      invoiceId: "inv1", orgId: ORG, storageId: "storage_a", now: NOW,
    });
    const second = await svc(t).mutation(api.financeArtifacts.attachInvoiceArtifact, {
      invoiceId: "inv1", orgId: ORG, storageId: "storage_b", now: NOW + 1,
    });

    expect(first).toEqual({ attached: true, pdfFileId: "storage_a" });
    expect(second).toEqual({ attached: false, pdfFileId: "storage_a" });
  });

  test("refuses a DRAFT invoice — its amounts are still mutable", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      svc(t).mutation(api.financeArtifacts.attachInvoiceArtifact, {
        invoiceId: "inv_draft", orgId: ORG, storageId: "storage_1", now: NOW,
      }),
    ).rejects.toThrow(/issued invoice/i);
  });

  test("cross-org attach is NOT_FOUND", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      svc(t).mutation(api.financeArtifacts.attachInvoiceArtifact, {
        invoiceId: "inv1", orgId: OTHER, storageId: "storage_evil", now: NOW,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("artifact context queries (what the download routes authorise against)", () => {
  test("a quote's context carries the STAMPED dates, not today's", async () => {
    const t = makeT();
    await seed(t);

    const ctx = await svc(t).query(api.financeArtifacts.quoteArtifactContext, {
      quoteId: "q1", orgId: ORG, now: NOW,
    });

    expect(ctx).toMatchObject({
      quoteId: "q1",
      projectNumber: "RVLT-2026-0087",
      version: 2,
      effectiveStatus: "SENT",
      label: "RVLT-2026-0087 v2",
      quoteDate: NOW,
      validUntil: NOW + 86_400_000 * 30,
      pdfFileId: null,
    });
  });

  test("a SUPERSEDED revision stays readable — the client may still hold that copy", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const q = await ctx.db.query("quotes").withIndex("by_cuid", (x) => x.eq("id", "q1")).first();
      await ctx.db.patch(q!._id, { status: "SUPERSEDED", pdfFileId: "storage_old" });
    });

    const ctx = await svc(t).query(api.financeArtifacts.quoteArtifactContext, {
      quoteId: "q1", orgId: ORG, now: NOW,
    });

    expect(ctx.effectiveStatus).toBe("SUPERSEDED");
    expect(ctx.pdfFileId).toBe("storage_old");
  });

  test("cross-org quote read is NOT_FOUND — the artifact route's IDOR guard", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      svc(t).query(api.financeArtifacts.quoteArtifactContext, { quoteId: "q1", orgId: OTHER, now: NOW }),
    ).rejects.toThrow(/not found/i);
  });

  test("cross-org invoice read is NOT_FOUND", async () => {
    const t = makeT();
    await seed(t);

    await expect(
      svc(t).query(api.financeArtifacts.invoiceArtifactContext, { invoiceId: "inv1", orgId: OTHER }),
    ).rejects.toThrow(/not found/i);
  });

  test("an invoice's context carries its OWN money snapshot and lines — never the live project's", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoiceLines", {
        id: "il1", invoiceId: "inv_draft", sourceType: "CUSTOM",
        description: "Deposit (25% of project total)", quantity: 1, unitPrice: 27.5, lineTotal: 27.5, sortOrder: 0,
      });
    });

    const ctx = await svc(t).query(api.financeArtifacts.invoiceArtifactContext, {
      invoiceId: "inv_draft", orgId: ORG,
    });

    expect(ctx.kind).toBe("DEPOSIT");
    expect(ctx.subtotal).toBe(25);
    expect(ctx.taxAmount).toBe(2.5);
    expect(ctx.total).toBe(27.5);
    expect(ctx.lines).toEqual([
      { id: "il1", description: "Deposit (25% of project total)", quantity: 1, unitPrice: 27.5, lineTotal: 27.5 },
    ]);
  });

  test("lines come back sorted by sortOrder, and an invoice with none returns an empty array", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoiceLines", {
        id: "il_b", invoiceId: "inv1", sourceType: "CUSTOM", description: "Second", quantity: 1, unitPrice: 1, lineTotal: 1, sortOrder: 1,
      });
      await ctx.db.insert("invoiceLines", {
        id: "il_a", invoiceId: "inv1", sourceType: "CUSTOM", description: "First", quantity: 1, unitPrice: 1, lineTotal: 1, sortOrder: 0,
      });
    });

    const withLines = await svc(t).query(api.financeArtifacts.invoiceArtifactContext, { invoiceId: "inv1", orgId: ORG });
    expect(withLines.lines.map((l) => l.description)).toEqual(["First", "Second"]);

    const withoutLines = await svc(t).query(api.financeArtifacts.invoiceArtifactContext, { invoiceId: "inv_draft", orgId: ORG });
    expect(withoutLines.lines).toEqual([]);
  });

  test("a quote whose PROJECT belongs to another org is NOT_FOUND (no cross-tenant join)", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (x) => x.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { organizationId: OTHER });
    });

    await expect(
      svc(t).query(api.financeArtifacts.quoteArtifactContext, { quoteId: "q1", orgId: ORG, now: NOW }),
    ).rejects.toThrow(/not found/i);
  });
});
