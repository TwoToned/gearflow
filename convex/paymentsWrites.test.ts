// @vitest-environment node
//
// convex/paymentsWrites.ts — record/void a payment against an ISSUED invoice.
// Verifies: amountPaid/paymentStatus are derived and recomputed in the same
// transaction as the payment write (never hand-typed), an invoice must be
// ISSUED to receive a payment, RBAC (record_payment vs void_payment tiers),
// and cross-tenant IDOR protection.
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

async function seedMember(t: ReturnType<typeof makeT>, role = "owner", orgId = ORG, userId = USER) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m_${userId}_${orgId}`, organizationId: orgId, userId, role });
  });
}

/** Patch an existing member's role — used to downgrade AFTER setup steps that
 *  themselves need a higher-tier permission (e.g. issueNative needs `issue`,
 *  which `member` lacks) so only the actual mutation under test runs as the
 *  role being checked. */
async function setRole(t: ReturnType<typeof makeT>, role: string, orgId = ORG, userId = USER) {
  await t.run(async (ctx) => {
    const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId)).first();
    await ctx.db.patch(m!._id, { role });
  });
}

async function seedProjectAndClient(t: ReturnType<typeof makeT>, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("clients", { id: "c1", organizationId: orgId, name: "Acme Events" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P1", name: "Gig", clientId: "c1",
      status: "CONFIRMED", isTemplate: false, subtotal: 1000, discountAmount: 0, taxAmount: 100, total: 1100, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
    });
    // `seedIssuedInvoice` below issues against this project — issuing now
    // requires an ACCEPTED quote at the invoice's linked revision (2026-08).
    await ctx.db.insert("quotes", {
      id: "q1", organizationId: orgId, projectId: "p1", version: 1, status: "ACCEPTED",
      snapshot: null, createdAt: NOW, updatedAt: NOW,
    });
  });
}

const autoNumber = {
  format: "INV-%YYYY-%SEQ",
  reset: "YEARLY" as const,
  padding: 4,
  parts: datePartsInTimezone(new Date(NOW)),
};

async function seedIssuedInvoice(t: ReturnType<typeof makeT>, orgId = ORG) {
  await t.withIdentity(asUser(orgId)).mutation(api.invoicesWrites.createNative, {
    id: "i1", organizationId: orgId, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
  });
  await t.withIdentity(asUser(orgId)).mutation(api.invoicesWrites.issueNative, {
    id: "i1", orgId, autoNumber, actor, auditId: "a2", now: NOW,
  });
}

const getInvoice = (t: ReturnType<typeof makeT>, id = "i1") =>
  t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const getPayment = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => ctx.db.query("payments").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const record = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.recordNative, {
    id: "pay1", orgId: ORG, invoiceId: "i1", amount: 275, method: "BANK_TRANSFER", paidAt: NOW, actor, auditId: "a3", now: NOW + 1, ...over,
  } as never);

describe("paymentsWrites.recordNative", () => {
  test("records a partial payment and sets amountPaid + paymentStatus to PARTIALLY_PAID", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t); // total: 1100

    await record(t, { amount: 275 });

    const inv = await getInvoice(t);
    expect(inv?.amountPaid).toBe(275);
    expect(inv?.paymentStatus).toBe("PARTIALLY_PAID");

    const payment = await getPayment(t, "pay1");
    expect(payment?.amount).toBe(275);
    expect(payment?.invoiceId).toBe("i1");
    expect(payment?.projectId).toBe("p1");
  });

  test("paying the full total sets paymentStatus to PAID", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);

    await record(t, { amount: 1100 });

    const inv = await getInvoice(t);
    expect(inv?.amountPaid).toBe(1100);
    expect(inv?.paymentStatus).toBe("PAID");
  });

  test("two partial payments sum to amountPaid and the second can complete PAID", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);

    await record(t, { id: "pay1", amount: 600 });
    await record(t, { id: "pay2", amount: 500 });

    const inv = await getInvoice(t);
    expect(inv?.amountPaid).toBe(1100);
    expect(inv?.paymentStatus).toBe("PAID");
  });

  test("rejects recording a payment against a DRAFT invoice", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    await expect(record(t)).rejects.toThrow(/only.*be recorded against an issued invoice/i);
  });

  test("rejects a non-positive amount", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);

    await expect(record(t, { amount: 0 })).rejects.toThrow(/amount must be at least/i);
  });

  test("a manager can record a payment (same tier as issue/xero_push)", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);

    await record(t, { amount: 100 });
    expect((await getInvoice(t))?.amountPaid).toBe(100);
  });

  test("a member cannot record a payment", async () => {
    const t = makeT();
    await seedMember(t, "owner"); // owner to get the invoice ISSUED first
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);
    await setRole(t, "member"); // then downgrade — only the record() call is under test

    await expect(record(t)).rejects.toThrow(/forbidden|permission/i);
  });

  test("rejects a cross-org invoiceId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProjectAndClient(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: OTHER, projectId: "p1", clientId: "c1", kind: "FULL",
      actor: { userId: "user_2", userName: "Bob" }, auditId: "a1", now: NOW,
    });
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: OTHER, autoNumber, actor: { userId: "user_2", userName: "Bob" }, auditId: "a2", now: NOW,
    });

    await expect(record(t)).rejects.toThrow(/not found in your organization/i);
  });
});

describe("paymentsWrites.voidNative", () => {
  test("voids a payment and recomputes the parent invoice's amountPaid/paymentStatus", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);
    await record(t, { amount: 1100 }); // fully paid

    await t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
      id: "pay1", orgId: ORG, reason: "Recorded against the wrong invoice", actor, auditId: "a4", now: NOW + 2,
    });

    const inv = await getInvoice(t);
    expect(inv?.amountPaid).toBe(0);
    expect(inv?.paymentStatus).toBe("UNPAID");

    const payment = await getPayment(t, "pay1");
    expect(payment?.voidedAt).toBe(NOW + 2);
    expect(payment?.voidReason).toBe("Recorded against the wrong invoice");
  });

  test("a voided payment no longer counts toward amountPaid alongside a live one", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);
    await record(t, { id: "pay1", amount: 600 });
    await record(t, { id: "pay2", amount: 500 });

    await t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
      id: "pay1", orgId: ORG, reason: "duplicate entry", actor, auditId: "a4", now: NOW + 2,
    });

    const inv = await getInvoice(t);
    expect(inv?.amountPaid).toBe(500);
    expect(inv?.paymentStatus).toBe("PARTIALLY_PAID");
  });

  test("rejects voiding an already-voided payment", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);
    await record(t, { amount: 500 });
    await t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
      id: "pay1", orgId: ORG, reason: "first void", actor, auditId: "a4", now: NOW + 2,
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
        id: "pay1", orgId: ORG, reason: "second void", actor, auditId: "a5", now: NOW + 3,
      }),
    ).rejects.toThrow(/already voided/i);
  });

  test("rejects an empty reason", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);
    await record(t, { amount: 500 });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
        id: "pay1", orgId: ORG, reason: "", actor, auditId: "a4", now: NOW + 2,
      }),
    ).rejects.toThrow(/at least/i);
  });

  test("a manager cannot void a payment (owner/admin only)", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProjectAndClient(t);
    await seedIssuedInvoice(t);
    await record(t, { amount: 500 });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
        id: "pay1", orgId: ORG, reason: "trying anyway", actor, auditId: "a4", now: NOW + 2,
      }),
    ).rejects.toThrow(/forbidden|permission/i);
  });
});
