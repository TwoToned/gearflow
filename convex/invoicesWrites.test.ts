// @vitest-environment node
//
// convex/invoicesWrites.ts — invoice create/issue/void/credit. Verifies:
// server-computed money for FULL/DEPOSIT/BALANCE kinds, issue-time numbering
// (gapless, namespaced scopeKey — never collides with the project-number
// counter), immutability once ISSUED, the RBAC + lifecycle-lock guards, and
// cross-tenant IDOR protection on projectId/clientId (R-8.4.3).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { datePartsInTimezone } from "./lib/projectNumber";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000; // 2023-11-14
const actor = { userId: USER, userName: "Alice" };
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: ReturnType<typeof makeT>, role = "owner") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
  });
}

async function seedProjectAndClient(t: ReturnType<typeof makeT>, orgId = ORG, status = "QUOTING") {
  await t.run(async (ctx) => {
    await ctx.db.insert("clients", { id: "c1", organizationId: orgId, name: "Acme Events" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P1", name: "Gig", clientId: "c1",
      status, isTemplate: false, subtotal: 1000, discountAmount: 0, taxAmount: 100, total: 1100, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
    });
  });
}

const autoNumber = {
  format: "INV-%YYYY-%SEQ",
  reset: "YEARLY" as const,
  padding: 4,
  parts: datePartsInTimezone(new Date(NOW)),
};

const getInvoice = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const getLines = (t: ReturnType<typeof makeT>, invoiceId: string) =>
  t.run(async (ctx) => ctx.db.query("invoiceLines").withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId)).collect());

describe("invoicesWrites.createNative", () => {
  test("FULL invoice snapshots the project's current totals + line breakdown", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 1000, lineTotal: 1000,
      });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    expect(inv?.status).toBe("DRAFT");
    expect(inv?.invoiceNumber).toBeUndefined();
    expect(inv?.total).toBe(1100);
    expect(inv?.subtotal).toBe(1000);
    expect(inv?.taxAmount).toBe(100);

    const lines = await getLines(t, "i1");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe("PA System");
    expect(lines[0]?.lineTotal).toBe(1000);
  });

  test("DEPOSIT invoice is a % of the tax-INCLUSIVE total, with its own GST fraction", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", depositPercent: 25, actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    expect(inv?.total).toBe(275); // 25% of 1100
    expect(inv?.taxAmount).toBeCloseTo(25, 2); // 275 * (100/1100)
    expect(inv?.subtotal).toBeCloseTo(250, 2);
    expect(inv?.depositPercent).toBe(25);

    const lines = await getLines(t, "i1");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toContain("Deposit");
  });

  test("BALANCE invoice subtracts every prior non-VOID DEPOSIT invoice's total (server-computed, not client-supplied)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", { id: "dep1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED", subtotal: 250, taxAmount: 25, total: 275, invoiceNumber: "INV-2023-0001" });
      await ctx.db.insert("invoices", { id: "dep2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "VOID", subtotal: 100, taxAmount: 10, total: 110, invoiceNumber: "INV-2023-0002" });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "bal1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "bal1");
    expect(inv?.total).toBe(825); // 1100 - 275 (the voided 110 does NOT count)
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Same-id different-org client" });
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/not found in your organization/i);
  });

  test("rejects a cross-org clientId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c-other", organizationId: OTHER, name: "Foreign client" });
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i1", organizationId: ORG, projectId: "p1", clientId: "c-other", kind: "FULL", actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/not found in your organization/i);
  });
});

describe("invoicesWrites.issueNative", () => {
  test("assigns a gapless invoice number and never re-numbers on a second issue", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a2", now: NOW,
    });

    const r1 = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, actor, auditId: "a3", now: NOW,
    });
    const r2 = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i2", orgId: ORG, autoNumber, actor, auditId: "a4", now: NOW,
    });
    expect(r1.invoiceNumber).toBe("INV-2023-0001");
    expect(r2.invoiceNumber).toBe("INV-2023-0002");

    // Re-issuing an already-ISSUED invoice is rejected (immutable once issued).
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a5", now: NOW }),
    ).rejects.toThrow(/only a draft invoice can be issued/i);
  });

  test("issuing updates the project's derived depositPaid/invoicedTotal", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", depositPercent: 25, actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.depositPaid).toBe(275);
    expect(p?.invoicedTotal).toBe(275);
  });

  test("the invoice-number counter never collides with the project-number counter (namespaced scopeKey)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      // A project-number counter already sitting at a HIGH value for the same
      // period — if the invoice counter shared the scopeKey it would start
      // from here instead of 1.
      await ctx.db.insert("projectNumberSequences", { id: "seq1", organizationId: ORG, scopeKey: "2023", value: 500 });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    const result = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
    });
    expect(result.invoiceNumber).toBe("INV-2023-0001");
  });
});

describe("invoicesWrites.voidNative / deleteDraftNative", () => {
  test("voids an ISSUED invoice and recomputes the project's derived totals", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.voidNative, {
      id: "i1", orgId: ORG, reason: "Client cancelled the job", actor, auditId: "a3", now: NOW + 1,
    });
    const inv = await getInvoice(t, "i1");
    expect(inv?.status).toBe("VOID");

    const p = await t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
    expect(p?.invoicedTotal).toBe(0);
  });

  test("rejects voiding a DRAFT invoice", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.voidNative, { id: "i1", orgId: ORG, reason: "oops", actor, auditId: "a2", now: NOW }),
    ).rejects.toThrow(/only an issued invoice can be voided/i);
  });

  test("deletes a DRAFT invoice + its lines, but rejects deleting an ISSUED one", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.deleteDraftNative, { id: "i1", orgId: ORG, actor, auditId: "a2", now: NOW });
    expect(await getInvoice(t, "i1")).toBeNull();
    expect(await getLines(t, "i1")).toHaveLength(0);

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a3", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i2", orgId: ORG, autoNumber, actor, auditId: "a4", now: NOW });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.deleteDraftNative, { id: "i2", orgId: ORG, actor, auditId: "a5", now: NOW }),
    ).rejects.toThrow(/only a draft invoice can be deleted/i);
  });
});

describe("invoicesWrites.createCreditNative", () => {
  test("credits an ISSUED invoice with negated amounts", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createCreditNative, {
      id: "cr1", orgId: ORG, creditForInvoiceId: "i1", actor, auditId: "a3", now: NOW + 1,
    });
    const credit = await getInvoice(t, "cr1");
    expect(credit?.kind).toBe("CREDIT");
    expect(credit?.total).toBe(-1100);
    expect(credit?.creditForInvoiceId).toBe("i1");
  });

  test("rejects crediting a DRAFT invoice", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createCreditNative, {
        id: "cr1", orgId: ORG, creditForInvoiceId: "i1", actor, auditId: "a2", now: NOW,
      }),
    ).rejects.toThrow(/can only credit an issued invoice/i);
  });
});
