// @vitest-environment node
//
// convex/financeOrg.ts `bundle`/`counts` — the org-level Finance section
// (#992, Phase F). End-to-end integration test through a real Convex-test DB
// (schema.ts, real indexes), verifying each of the six sections against a
// fixture that mixes true positives with deliberate "noise" (a different
// org's rows, an ACCEPTED quote, a CANCELLED project's draft, a PAID
// invoice) that must NOT surface — same convention as
// `overbookingBoard.test.ts`. A separate describe block proves the
// aggregation is bounded (SECTION_CAP), not a per-project loop, per the
// design doc's explicit test-plan requirement for this query.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { SECTION_CAP } from "./financeOrg";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER_ORG = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const asUser = { subject: USER, orgId: ORG };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedCoreFixture(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });

    await ctx.db.insert("clients", {
      id: "cli_deposit", organizationId: ORG, name: "Deposit Client", isActive: true,
      paymentProfile: "DEPOSIT_BALANCE", profileDepositPercent: 30,
    });
    await ctx.db.insert("clients", { id: "cli_full", organizationId: ORG, name: "Full Upfront Client", isActive: true });

    // P_sent: CONFIRMED, has a live SENT quote v1 — expiring soon (3 days out).
    await ctx.db.insert("projects", {
      id: "P_sent", organizationId: ORG, projectNumber: "P-SENT", name: "Sent job", status: "QUOTED",
      clientId: "cli_full", isTemplate: false, total: 5000, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("quotes", {
      id: "Q_sent", organizationId: ORG, projectId: "P_sent", version: 1, status: "SENT",
      sentAt: NOW - 10 * DAY, validUntil: NOW + 3 * DAY, snapshot: { total: 5000 }, createdAt: NOW - 10 * DAY,
    });

    // P_accepted: an ACCEPTED quote must NOT appear in quotesOut or expiring.
    await ctx.db.insert("projects", {
      id: "P_accepted", organizationId: ORG, projectNumber: "P-ACC", name: "Accepted job", status: "CONFIRMED",
      clientId: "cli_full", isTemplate: false, total: 7000, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("quotes", {
      id: "Q_accepted", organizationId: ORG, projectId: "P_accepted", version: 1, status: "ACCEPTED",
      sentAt: NOW - 20 * DAY, validUntil: NOW + 10 * DAY, acceptedAt: NOW - 15 * DAY,
      snapshot: { total: 7000 }, createdAt: NOW - 20 * DAY,
    });

    // P_draft: an active project with an unsent DRAFT — "Never sent".
    await ctx.db.insert("projects", {
      id: "P_draft", organizationId: ORG, projectNumber: "P-DRAFT", name: "Unsent job", status: "ENQUIRY",
      clientId: "cli_full", isTemplate: false, total: 1200, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("quotes", {
      id: "Q_draft", organizationId: ORG, projectId: "P_draft", version: 1, status: "DRAFT", snapshot: null, createdAt: NOW - 2 * DAY,
    });

    // P_draft_cancelled: DRAFT on a CANCELLED project — noise, must NOT surface.
    await ctx.db.insert("projects", {
      id: "P_draft_cancelled", organizationId: ORG, projectNumber: "P-CANC", name: "Cancelled job", status: "CANCELLED",
      clientId: "cli_full", isTemplate: false, total: 900, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("quotes", {
      id: "Q_draft_cancelled", organizationId: ORG, projectId: "P_draft_cancelled", version: 1, status: "DRAFT", snapshot: null, createdAt: NOW - 1 * DAY,
    });

    // P_uninvoiced: CONFIRMED, full-upfront client, no invoice at all —
    // "Confirmed but uninvoiced".
    await ctx.db.insert("projects", {
      id: "P_uninvoiced", organizationId: ORG, projectNumber: "P-UNINV", name: "No invoice yet", status: "CONFIRMED",
      clientId: "cli_full", isTemplate: false, total: 3000, rentalEndDate: NOW + 5 * DAY, createdAt: NOW, updatedAt: NOW, revision: 1,
    });

    // P_deposit_due: CONFIRMED, DEPOSIT_BALANCE client, no DEPOSIT invoice —
    // "Deposit due".
    await ctx.db.insert("projects", {
      id: "P_deposit_due", organizationId: ORG, projectNumber: "P-DEP", name: "Deposit owing", status: "CONFIRMED",
      clientId: "cli_deposit", isTemplate: false, total: 4000, createdAt: NOW, updatedAt: NOW, revision: 1,
    });

    // P_deposit_paid: DEPOSIT_BALANCE client, deposit already ISSUED — must NOT
    // surface in "Deposit due" (but is fully invoiced by kind, not FULL/BALANCE,
    // so also absent from confirmed-uninvoiced since it HAS an issued invoice).
    await ctx.db.insert("projects", {
      id: "P_deposit_paid", organizationId: ORG, projectNumber: "P-DEPOK", name: "Deposit invoiced", status: "CONFIRMED",
      clientId: "cli_deposit", isTemplate: false, total: 6000, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("invoices", {
      id: "INV_deposit_paid", organizationId: ORG, projectId: "P_deposit_paid", clientId: "cli_deposit",
      kind: "DEPOSIT", status: "ISSUED", paymentStatus: "PAID", invoiceNumber: "INV-1",
      issuedAt: NOW - 5 * DAY, subtotal: 1800, taxAmount: 0, total: 1800,
    });

    // P_outstanding: CONFIRMED, an ISSUED-but-unpaid FULL invoice — "Outstanding".
    await ctx.db.insert("projects", {
      id: "P_outstanding", organizationId: ORG, projectNumber: "P-OUT", name: "Owes money", status: "CONFIRMED",
      clientId: "cli_full", isTemplate: false, total: 9000, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("invoices", {
      id: "INV_outstanding", organizationId: ORG, projectId: "P_outstanding", clientId: "cli_full",
      kind: "FULL", status: "ISSUED", paymentStatus: "UNPAID", invoiceNumber: "INV-2",
      issuedAt: NOW - 3 * DAY, dueDate: NOW + 11 * DAY, subtotal: 9000, taxAmount: 0, total: 9000,
    });
    // Also gives P_outstanding an ISSUED invoice, so it must NOT appear in
    // "confirmed but uninvoiced" alongside P_uninvoiced.

    // NOISE: a different org entirely — every one of its rows must never surface
    // under ORG's bundle (R-8.4.3 cross-org check).
    await ctx.db.insert("members", { id: "m2", organizationId: OTHER_ORG, userId: "user_2", role: "owner" });
    await ctx.db.insert("clients", { id: "cli_other", organizationId: OTHER_ORG, name: "Other Org Client", isActive: true });
    await ctx.db.insert("projects", {
      id: "P_other", organizationId: OTHER_ORG, projectNumber: "OTHER-1", name: "Other org job", status: "CONFIRMED",
      clientId: "cli_other", isTemplate: false, total: 2000, createdAt: NOW, updatedAt: NOW, revision: 1,
    });
    await ctx.db.insert("quotes", {
      id: "Q_other", organizationId: OTHER_ORG, projectId: "P_other", version: 1, status: "SENT",
      sentAt: NOW - 1 * DAY, validUntil: NOW + 30 * DAY, snapshot: { total: 2000 }, createdAt: NOW - 1 * DAY,
    });
    await ctx.db.insert("invoices", {
      id: "INV_other", organizationId: OTHER_ORG, projectId: "P_other", clientId: "cli_other",
      kind: "FULL", status: "ISSUED", paymentStatus: "UNPAID", invoiceNumber: "OTHER-INV-1",
      issuedAt: NOW - 1 * DAY, subtotal: 2000, taxAmount: 0, total: 2000,
    });
  });
}

describe("financeOrg.bundle", () => {
  test("requires org membership (rejects an unauthenticated call)", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    await expect(t.query(api.financeOrg.bundle, { orgId: ORG, now: NOW })).rejects.toThrow();
  });

  test("cross-org: a caller authenticated for ORG never sees OTHER_ORG's rows", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });

    const allProjectIds = [
      ...result.quotesOut.map((r) => r.project.id),
      ...result.expiring.map((r) => r.project.id),
      ...result.neverSent.map((r) => r.project.id),
      ...result.confirmedUninvoiced.map((r) => r.project.id),
      ...result.depositDue.map((r) => r.project.id),
      ...result.outstanding.map((r) => r.project.id),
    ];
    expect(allProjectIds).not.toContain("P_other");
  });

  test("rejects a caller whose token org doesn't match the requested orgId (IDOR)", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    await expect(
      t.withIdentity({ subject: "user_2", orgId: OTHER_ORG }).query(api.financeOrg.bundle, { orgId: ORG, now: NOW }),
    ).rejects.toThrow();
  });

  test("quotesOut: only the live SENT quote, not the ACCEPTED one", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    expect(result.quotesOut.map((r) => r.quoteId)).toEqual(["Q_sent"]);
    expect(result.quotesOut.map((r) => r.quoteId)).not.toContain("Q_accepted");
  });

  test("expiring: the SENT quote inside the 7-day window", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    expect(result.expiring.map((r) => r.quoteId)).toEqual(["Q_sent"]);
    // Q_accepted's validUntil is 10 days out and it isn't SENT anyway.
    expect(result.expiring.map((r) => r.quoteId)).not.toContain("Q_accepted");
  });

  test("neverSent: the active project's DRAFT, excluding the CANCELLED project's DRAFT", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    expect(result.neverSent.map((r) => r.quoteId)).toEqual(["Q_draft"]);
    expect(result.neverSent.map((r) => r.quoteId)).not.toContain("Q_draft_cancelled");
  });

  test("confirmedUninvoiced: only the CONFIRMED project with zero issued invoices", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    const ids = result.confirmedUninvoiced.map((r) => r.project.id);
    expect(ids).toContain("P_uninvoiced");
    expect(ids).toContain("P_deposit_due"); // no invoice issued at all yet either
    expect(ids).not.toContain("P_outstanding"); // has an ISSUED invoice
    expect(ids).not.toContain("P_deposit_paid"); // has an ISSUED invoice
  });

  test("depositDue: DEPOSIT_BALANCE client with no issued DEPOSIT invoice, excluding one already issued", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    const ids = result.depositDue.map((r) => r.project.id);
    expect(ids).toEqual(["P_deposit_due"]);
    expect(ids).not.toContain("P_deposit_paid");
    expect(ids).not.toContain("P_uninvoiced"); // FULL_UPFRONT client, not deposit-balance
  });

  test("outstanding: the ISSUED+UNPAID invoice, excluding the PAID one", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    expect(result.outstanding.map((r) => r.invoiceId)).toEqual(["INV_outstanding"]);
    expect(result.outstanding.map((r) => r.invoiceId)).not.toContain("INV_deposit_paid");
  });

  test("counts mirrors bundle's section lengths", async () => {
    const t = makeT();
    await seedCoreFixture(t);
    const [bundle, counts] = await Promise.all([
      t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW }),
      t.withIdentity(asUser).query(api.financeOrg.counts, { orgId: ORG, now: NOW }),
    ]);
    expect(counts).toEqual({
      quotesOutCount: bundle.quotesOut.length,
      expiringCount: bundle.expiring.length,
      neverSentCount: bundle.neverSent.length,
      confirmedUninvoicedCount: bundle.confirmedUninvoiced.length,
      depositDueCount: bundle.depositDue.length,
      outstandingCount: bundle.outstanding.length,
    });
  });
});

describe("financeOrg.bundle — bounded read, not an org-wide/per-project scan", () => {
  test("a fixture with more SENT quotes than SECTION_CAP is truncated, not fully collected", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "owner" });
      await ctx.db.insert("clients", { id: "cli_bulk", organizationId: ORG, name: "Bulk Client", isActive: true });
      const overflow = SECTION_CAP + 25;
      for (let i = 0; i < overflow; i++) {
        const pid = `P_bulk_${i}`;
        await ctx.db.insert("projects", {
          id: pid, organizationId: ORG, projectNumber: `P-BULK-${i}`, name: `Bulk job ${i}`, status: "QUOTED",
          clientId: "cli_bulk", isTemplate: false, total: 100, createdAt: NOW, updatedAt: NOW, revision: 1,
        });
        await ctx.db.insert("quotes", {
          id: `Q_bulk_${i}`, organizationId: ORG, projectId: pid, version: 1, status: "SENT",
          sentAt: NOW - i * 1000, validUntil: NOW + 60 * DAY, snapshot: { total: 100 }, createdAt: NOW,
        });
      }
    });

    const result = await t.withIdentity(asUser).query(api.financeOrg.bundle, { orgId: ORG, now: NOW });
    expect(result.quotesOut.length).toBeLessThanOrEqual(SECTION_CAP);
    expect(result.capped).toBe(true);
  });
});
