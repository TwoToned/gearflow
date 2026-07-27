// @vitest-environment node
//
// convex/xeroPush.ts — push-time coding resolution IN CONTEXT (real DB reads
// through the cascade, not just the pure resolver functions xeroAccountCascade
// .test.ts already covers). Verifies every level actually gets read from the
// right doc for a real invoice's lines, and the two apply/fail mutations.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const SERVICE = { subject: "gearflow-service", svc: true };

function makeT() {
  return convexTest(schema, modules);
}

async function seedInvoiceWithLines(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("invoices", { id: "inv1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 900, taxAmount: 90, total: 990, invoiceNumber: "INV-1" });

    await ctx.db.insert("categories", { id: "cat1", organizationId: ORG, name: "Audio", xeroAccountCode: "4300" });
    await ctx.db.insert("models", { id: "mod1", organizationId: ORG, name: "Speaker", xeroRentalAccountCode: "4200", xeroSaleAccountCode: "4250" });
    await ctx.db.insert("kits", { id: "kit1", organizationId: ORG, assetTag: "KIT-1", name: "Band Kit", xeroAccountCode: "4400" });

    // Line 1: EQUIPMENT, model-backed, no per-line override -> should resolve to the model's rental code.
    await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", isKitChild: false, modelId: "mod1", categoryId: "cat1", description: "Speaker", quantity: 1, unitPrice: 200, lineTotal: 200 });
    // Line 2: EQUIPMENT, kit parent -> should resolve to the kit's code, ignoring the category.
    await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", isKitChild: false, kitId: "kit1", categoryId: "cat1", description: "Band Kit", quantity: 1, unitPrice: 300, lineTotal: 300 });
    // Line 3: EQUIPMENT, per-line override -> should win over everything else.
    await ctx.db.insert("projectLineItems", { id: "li3", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", isKitChild: false, modelId: "mod1", categoryId: "cat1", xeroAccountCode: "9999-OVERRIDE", xeroTaxType: "EXEMPT", description: "Special item", quantity: 1, unitPrice: 100, lineTotal: 100 });
    // Line 4: EQUIPMENT, no model/kit/category -> falls through to org default.
    await ctx.db.insert("projectLineItems", { id: "li4", organizationId: ORG, projectId: "p1", type: "EQUIPMENT", isKitChild: false, description: "Misc gear", quantity: 1, unitPrice: 50, lineTotal: 50 });
    // Line 5: SERVICE, LABOUR type -> resolves via the LABOUR service-type default.
    await ctx.db.insert("projectServices", { id: "svc1", organizationId: ORG, projectId: "p1", type: "LABOUR", title: "Crew", lineTotal: 150 });

    await ctx.db.insert("invoiceLines", { id: "line1", invoiceId: "inv1", sourceType: "EQUIPMENT", sourceLineItemId: "li1", description: "Speaker", quantity: 1, unitPrice: 200, lineTotal: 200, sortOrder: 0 });
    await ctx.db.insert("invoiceLines", { id: "line2", invoiceId: "inv1", sourceType: "EQUIPMENT", sourceLineItemId: "li2", description: "Band Kit", quantity: 1, unitPrice: 300, lineTotal: 300, sortOrder: 1 });
    await ctx.db.insert("invoiceLines", { id: "line3", invoiceId: "inv1", sourceType: "EQUIPMENT", sourceLineItemId: "li3", description: "Special item", quantity: 1, unitPrice: 100, lineTotal: 100, sortOrder: 2 });
    await ctx.db.insert("invoiceLines", { id: "line4", invoiceId: "inv1", sourceType: "EQUIPMENT", sourceLineItemId: "li4", description: "Misc gear", quantity: 1, unitPrice: 50, lineTotal: 50, sortOrder: 3 });
    await ctx.db.insert("invoiceLines", { id: "line5", invoiceId: "inv1", sourceType: "SERVICE", sourceLineItemId: "svc1", description: "Crew", quantity: 1, unitPrice: 150, lineTotal: 150, sortOrder: 4 });

    await ctx.db.insert("xeroIntegrations", {
      id: "xi1", organizationId: ORG, isConnected: true, tenantId: "tenant1",
      defaultAccountCode: "4000", defaultTaxType: "OUTPUT2",
      serviceAccountDefaults: { LABOUR: "4600" },
    });
  });
}

describe("xeroPush.resolveCodingForInvoice", () => {
  test("resolves every cascade level correctly from real DB rows", async () => {
    const t = makeT();
    await seedInvoiceWithLines(t);
    const result = await t.withIdentity(SERVICE).query(api.xeroPush.resolveCodingForInvoice, { invoiceId: "inv1", orgId: ORG });
    const byId = new Map(result.lines.map((l) => [l.lineId, l]));

    expect(byId.get("line1")).toEqual({ lineId: "line1", accountCode: "4200", taxType: "OUTPUT2" }); // model rental code, org default tax
    expect(byId.get("line2")).toEqual({ lineId: "line2", accountCode: "4400", taxType: "OUTPUT2" }); // kit code wins over category
    expect(byId.get("line3")).toEqual({ lineId: "line3", accountCode: "9999-OVERRIDE", taxType: "EXEMPT" }); // per-line override wins over everything
    expect(byId.get("line4")).toEqual({ lineId: "line4", accountCode: "4000", taxType: "OUTPUT2" }); // org default (no model/kit/category)
    expect(byId.get("line5")).toEqual({ lineId: "line5", accountCode: "4600", taxType: "OUTPUT2" }); // LABOUR service-type default
  });

  test("flags a variance note when a line's tax type diverges from the org default", async () => {
    const t = makeT();
    await seedInvoiceWithLines(t);
    const result = await t.withIdentity(SERVICE).query(api.xeroPush.resolveCodingForInvoice, { invoiceId: "inv1", orgId: ORG });
    // line3 has an EXEMPT override vs the org default OUTPUT2.
    expect(result.varianceNote).toMatch(/1 line/i);
  });

  test("no variance note when every line uses the org default tax type", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", { id: "inv2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 100, taxAmount: 10, total: 110, invoiceNumber: "INV-2" });
      await ctx.db.insert("invoiceLines", { id: "line10", invoiceId: "inv2", sourceType: "CUSTOM", description: "Balance due", quantity: 1, unitPrice: 110, lineTotal: 110, sortOrder: 0 });
      await ctx.db.insert("xeroIntegrations", { id: "xi2", organizationId: ORG, isConnected: true, tenantId: "t2", defaultAccountCode: "4000", defaultTaxType: "OUTPUT2" });
    });
    const result = await t.withIdentity(SERVICE).query(api.xeroPush.resolveCodingForInvoice, { invoiceId: "inv2", orgId: ORG });
    expect(result.varianceNote).toBeNull();
  });

  test("rejects a cross-org invoiceId (IDOR guard)", async () => {
    const t = makeT();
    await seedInvoiceWithLines(t);
    await expect(
      t.withIdentity(SERVICE).query(api.xeroPush.resolveCodingForInvoice, { invoiceId: "inv1", orgId: "org_other" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("xeroPush.applyXeroPushResultNative / markXeroPushFailedNative", () => {
  test("applies resolved coding onto invoiceLines and marks the invoice SYNCED", async () => {
    const t = makeT();
    await seedInvoiceWithLines(t);
    await t.withIdentity(SERVICE).mutation(api.xeroPush.applyXeroPushResultNative, {
      invoiceId: "inv1", orgId: ORG, xeroInvoiceId: "xero-inv-1",
      resolvedLines: [{ lineId: "line1", accountCode: "4200", taxType: "OUTPUT2" }],
      now: 1000,
    });
    const invoice = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "inv1")).first());
    expect(invoice?.xeroInvoiceId).toBe("xero-inv-1");
    expect(invoice?.xeroSyncStatus).toBe("SYNCED");
    const line1 = await t.run(async (ctx) => ctx.db.query("invoiceLines").withIndex("by_cuid", (q) => q.eq("id", "line1")).first());
    expect(line1?.xeroAccountCode).toBe("4200");
    expect(line1?.xeroTaxType).toBe("OUTPUT2");
  });

  test("marks a failed push as ERROR with the error message stored", async () => {
    const t = makeT();
    await seedInvoiceWithLines(t);
    await t.withIdentity(SERVICE).mutation(api.xeroPush.markXeroPushFailedNative, {
      invoiceId: "inv1", orgId: ORG, error: "Xero returned 400: ValidationException", now: 1000,
    });
    const invoice = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "inv1")).first());
    expect(invoice?.xeroSyncStatus).toBe("ERROR");
    expect(invoice?.lastSyncError).toBe("Xero returned 400: ValidationException");
  });
});
