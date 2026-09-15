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
import type { Doc } from "./_generated/dataModel";

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

/**
 * `quoteStatus` seeds a v1 `quotes` row at that status by default — most of
 * this file's `issueNative` calls predate the accepted-quote gate (2026-08)
 * and never cared about quote state, so defaulting to `"ACCEPTED"` keeps them
 * passing unchanged. Pass `null` (no quote row at all) or another status to
 * exercise the gate itself (see `invoicesWrites.issueNative — accepted-quote
 * gate` below).
 */
async function seedProjectAndClient(
  t: ReturnType<typeof makeT>,
  orgId = ORG,
  status: Doc<"projects">["status"] = "QUOTING",
  quoteStatus: Doc<"quotes">["status"] | null = "ACCEPTED",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("clients", { id: "c1", organizationId: orgId, name: "Acme Events" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P1", name: "Gig", clientId: "c1",
      status, isTemplate: false, subtotal: 1000, discountAmount: 0, taxAmount: 100, total: 1100, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
      liveVersionId: "v-p1",
    });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: orgId, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    if (quoteStatus) {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: orgId, projectId: "p1", version: 1, status: quoteStatus,
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    }
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
        versionId: "v-p1",
        lineageId: "l1",
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

  test("$-mode DEPOSIT invoice uses the entered amount as total, with the same proportional GST split", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
      depositMode: "$", depositAmount: 500, actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    expect(inv?.total).toBe(500);
    expect(inv?.taxAmount).toBeCloseTo(500 * (100 / 1100), 2);
    expect(inv?.subtotal).toBeCloseTo(500 - 500 * (100 / 1100), 2);
    expect(inv?.depositMode).toBe("$");
    expect(inv?.depositAmount).toBe(500);
    expect(inv?.depositPercent).toBeUndefined();

    const lines = await getLines(t, "i1");
    // The description states the basis only — printing the tax-inclusive
    // figure beside an ex-tax line amount is the contradiction we removed.
    expect(lines[0]?.description).toBe("Deposit");
  });

  test("rejects a $-mode deposit amount exceeding the project total", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t); // project total is 1100

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
        depositMode: "$", depositAmount: 1100.01, actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/cannot exceed the remaining balance/i);
  });

  test("multiple partial invoices are allowed, but a later one is bounded by what's already been invoiced, not the full total again", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t); // project total is 1100
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "dep1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED",
        subtotal: 636.36, taxAmount: 63.64, total: 700, invoiceNumber: "INV-2023-0001",
      });
    });

    // A second $500 partial would total $1200 across both — more than the
    // $1100 project is worth — so it's rejected even though $500 alone is
    // under the full project total.
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
        depositMode: "$", depositAmount: 500, actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/exceed the remaining balance/i);

    // A $400 second partial fits within the $400 that's left.
    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i3", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
      depositMode: "$", depositAmount: 400, actor, auditId: "a2", now: NOW,
    });
    const inv = await getInvoice(t, id);
    expect(inv?.total).toBe(400);
  });

  test("a % partial that would exceed what's left is rejected", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t); // project total is 1100
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "dep1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED",
        depositPercent: 80, subtotal: 800, taxAmount: 80, total: 880, invoiceNumber: "INV-2023-0001",
      });
    });

    // 80% (880) is already invoiced — another 50% (550) would push it past 1100.
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
        depositPercent: 50, actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/exceed the remaining balance/i);
  });

  test("rejects a BALANCE invoice when nothing is left to invoice", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t); // project total is 1100
    await t.run(async (ctx) => {
      // A single partial already covers the entire project total.
      await ctx.db.insert("invoices", {
        id: "dep1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED",
        subtotal: 1000, taxAmount: 100, total: 1100, invoiceNumber: "INV-2023-0001",
      });
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/nothing left to invoice/i);
  });

  test("% mode is still the default when depositMode is omitted (unaffected by #1055)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", depositPercent: 10, actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    expect(inv?.depositMode).toBe("%");
    expect(inv?.total).toBe(110); // 10% of 1100
    expect(inv?.depositAmount).toBeUndefined();
  });

  test("BALANCE nets against a mix of %-mode and $-mode DEPOSIT invoices", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "dep1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", status: "ISSUED",
        subtotal: 227, taxAmount: 23, total: 250, depositMode: "$", depositAmount: 250, invoiceNumber: "INV-2023-0001",
      });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "bal1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "bal1");
    expect(inv?.total).toBe(850); // 1100 - 250
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

  // Regression: accepting a quote and confirming the project (the normal path
  // to raising an invoice) puts the project at FINANCE_LOCKED tier. createNative
  // must NOT route through assertLifecycleGuard's "financial" kind — that guard
  // is for edits to LOCKED_*_FIELDS (unitPrice/discount/taxRate/group price),
  // which this mutation never touches (it only snapshots current pricing into
  // a separate invoices/invoiceLines row). Before the fix this threw
  // FINANCIALS_LOCKED on every CONFIRMED+ project with no unlock session open.
  test("creates a DRAFT invoice on a CONFIRMED (finance-locked) project with no unlock session open", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "CONFIRMED");

    const { id } = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, id);
    expect(inv?.status).toBe("DRAFT");
    expect(inv?.total).toBe(1100);
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
  // Regression: same FINANCIALS_LOCKED misuse as createNative — issuing a
  // DRAFT invoice on a CONFIRMED project must not require an unlock session.
  test("issues a DRAFT invoice on a CONFIRMED (finance-locked) project with no unlock session open", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "CONFIRMED");
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const result = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
    });
    expect(result.invoiceNumber).toBe("INV-2023-0001");
  });

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

  // #989 — regression for the live bug this closes: the panel used to call
  // `issue(id)` with no date argument at all, so EVERY invoice issued had no
  // due date. `invoiceDate`/`dueDate` are now always stamped, one or the other
  // way, even when the caller supplies neither.
  test("stamps invoiceDate (defaulting to now) and dueDate (defaulting to invoiceDate + paymentTermsDays) even when neither is supplied", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
    });

    const invoice = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "i1")).first());
    expect(invoice?.invoiceDate).not.toBeNull();
    expect(invoice?.invoiceDate).not.toBeUndefined();
    expect(invoice?.dueDate).not.toBeNull();
    expect(invoice?.dueDate).not.toBeUndefined();
    // Net 14 default (DEFAULT_PAYMENT_TERMS_DAYS), no org override configured.
    // invoiceDate is start-of-day; dueDate is the END of the 14th day after —
    // i.e. 15 whole days later, minus 1ms (mirrors computeValidUntil's contract).
    expect(invoice!.dueDate! - invoice!.invoiceDate!).toBe(15 * 86_400_000 - 1);
  });

  test("an explicit invoiceDate + dueDate override the default", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const chosenInvoiceDate = Date.UTC(2026, 6, 26);
    const chosenDueDate = Date.UTC(2026, 6, 28);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, invoiceDate: chosenInvoiceDate, dueDate: chosenDueDate, notes: "Net 2, rush job", actor, auditId: "a2", now: NOW,
    });

    const invoice = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "i1")).first());
    expect(new Date(invoice!.invoiceDate!).toISOString().slice(0, 10)).toBe("2026-07-26");
    expect(new Date(invoice!.dueDate!).toISOString().slice(0, 10)).toBe("2026-07-28");
    expect(invoice?.notes).toBe("Net 2, rush job");
  });

  test("respects the org's configured paymentTermsDays", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", { organizationId: ORG, settings: JSON.stringify({ documents: { paymentTermsDays: 7 } }) });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, invoiceDate: NOW, actor, auditId: "a2", now: NOW,
    });

    const invoice = await t.run(async (ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "i1")).first());
    expect(invoice!.dueDate! - invoice!.invoiceDate!).toBe(8 * 86_400_000 - 1);
  });
});

describe("invoicesWrites.issueNative — accepted-quote gate (2026-08)", () => {
  // Draft creation stays completely ungated — only ISSUING checks quote state,
  // against the specific revision stamped on the invoice at creation
  // (`sourceRevision`, never updated afterwards).
  test("succeeds when the invoice's linked quote revision is ACCEPTED", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "QUOTING", "ACCEPTED");
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const result = await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
      id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
    });
    expect(result.invoiceNumber).toBe("INV-2023-0001");
  });

  test.each(["DRAFT", "SENT", "DECLINED", "SUPERSEDED"] as const)(
    "rejects with QUOTE_NOT_ACCEPTED when the linked quote is %s",
    async (quoteStatus) => {
      const t = makeT();
      await seedMember(t);
      await seedProjectAndClient(t, ORG, "QUOTING", quoteStatus);
      await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
        id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
      });

      await expect(
        t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
          id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
        }),
      ).rejects.toThrow(/not accepted/i);
    },
  );

  test("rejects with QUOTE_NOT_ACCEPTED when the quote at that revision is EXPIRED", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "QUOTING", null);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "SENT",
        validUntil: NOW - 1, snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
        id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
      }),
    ).rejects.toThrow(/not accepted/i);
  });

  test("rejects with QUOTE_NOT_ACCEPTED when no quote exists at all for the project", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "QUOTING", null);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
        id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
      }),
    ).rejects.toThrow(/no quote exists/i);
  });

  // A pre-#1097 row (or any row a backfill hasn't reached) can lack
  // `sourceRevision` entirely — fails closed rather than silently allowing
  // it through.
  test("rejects a legacy invoice with no sourceRevision at all", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "QUOTING", "ACCEPTED");
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.run(async (ctx) => {
      const inv = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "i1")).first();
      await ctx.db.patch(inv!._id, { sourceRevision: undefined });
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, {
        id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW,
      }),
    ).rejects.toThrow(/no linked quote version/i);
  });

  test("draft creation, editing and deletion stay ungated regardless of quote state", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t, ORG, "QUOTING", "DECLINED");

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    const inv = await getInvoice(t, "i1");
    expect(inv?.status).toBe("DRAFT");

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.deleteDraftNative, {
      id: "i1", orgId: ORG, actor, auditId: "a2", now: NOW,
    });
    expect(await getInvoice(t, "i1")).toBeNull();
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

/**
 * The tax-EXCLUSIVE line invariant: `sum(invoiceLines.lineTotal)` equals the
 * invoice's own `subtotal`, with `taxAmount` added on top — for EVERY kind,
 * not just FULL.
 *
 * Reported 2026-09-15 against INV-260901. DEPOSIT/BALANCE/CREDIT wrote their
 * summary line at the tax-INCLUSIVE `total` instead, which no existing test
 * caught because they only ever asserted on the invoice row's money, never on
 * the line's. Two things broke downstream, both silently:
 *
 *   - Flow's own PDF printed a $330.00 line above a $300.00 Subtotal.
 *   - The Xero push (whose `LineAmount` contract is tax-exclusive) had GST
 *     added on top of the already-inclusive figure, billing the client
 *     $363.00 with $33.00 GST for an invoice Flow issued at $330.00 / $30.00.
 *
 * `src/server/xero.ts`'s `assertLinesReconcileWithSubtotal` is the guard that
 * refuses a push when this invariant is broken; these tests are what keep it
 * from ever needing to fire.
 */
describe("invoicesWrites — invoice lines are tax-EXCLUSIVE (sum(lineTotal) === taxable base)", () => {
  const sumLines = (lines: Doc<"invoiceLines">[]) =>
    Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
  /** What Xero charges tax on, and the figure `assertLinesReconcileWithTaxableBase`
   *  (src/server/xero.ts) holds the lines against. Equals `subtotal` for every
   *  kind EXCEPT a FULL invoice on a discounted project. */
  const taxableBase = (inv: Doc<"invoices">) => Math.round((inv.total - inv.taxAmount) * 100) / 100;

  test("a %-mode DEPOSIT line carries the ex-GST subtotal, not the GST-inclusive total", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", depositPercent: 25, actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    const lines = await getLines(t, "i1");
    // The deposit BASIS is unchanged — still 25% of the tax-inclusive $1100.
    expect(inv?.total).toBe(275);
    expect(inv?.taxAmount).toBeCloseTo(25, 2);
    // …but the LINE is the ex-GST $250, which is what `subtotal` says.
    expect(lines[0]?.lineTotal).toBeCloseTo(250, 2);
    expect(lines[0]?.unitPrice).toBeCloseTo(250, 2);
    expect(sumLines(lines)).toBeCloseTo(inv!.subtotal, 2);
    expect(sumLines(lines)).toBeCloseTo(taxableBase(inv!), 2);
    // The description still quotes the inclusive basis the operator asked for.
    expect(lines[0]?.description).toBe("Deposit (25% of project total)");
  });

  test("a $-mode DEPOSIT line splits the entered inclusive amount the same way", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT",
      depositMode: "$", depositAmount: 550, actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    const lines = await getLines(t, "i1");
    expect(inv?.total).toBe(550);
    expect(sumLines(lines)).toBeCloseTo(inv!.subtotal, 2);
    expect(lines[0]?.lineTotal).toBeCloseTo(500, 2);
    // The description must NOT print the inclusive $550 next to a $500 line —
    // the typed figure is on the document as the Total.
    expect(lines[0]?.description).toBe("Deposit");
    expect(lines[0]?.description).not.toContain("550");
  });

  test("a BALANCE line carries the ex-GST subtotal of what's left", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "DEPOSIT", depositPercent: 25, actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i2", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "BALANCE", actor, auditId: "a2", now: NOW,
    });

    const inv = await getInvoice(t, "i2");
    const lines = await getLines(t, "i2");
    expect(inv?.total).toBe(825); // 1100 - 275
    expect(sumLines(lines)).toBeCloseTo(inv!.subtotal, 2);
    expect(lines[0]?.lineTotal).toBeCloseTo(750, 2); // 825 ex-GST
  });

  test("a CREDIT line negates the original's ex-GST subtotal, not its inclusive total", async () => {
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
    const lines = await getLines(t, "cr1");
    expect(credit?.total).toBe(-1100);
    expect(credit?.taxAmount).toBe(-100);
    expect(lines[0]?.lineTotal).toBe(-1000);
    expect(sumLines(lines)).toBeCloseTo(taxableBase(credit!), 2);
  });

  test("a FULL invoice already held the invariant — its lines are the project's ex-tax rows", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 1000, lineTotal: 1000,
        versionId: "v-p1",
        lineageId: "l1",
      });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    const lines = await getLines(t, "i1");
    expect(sumLines(lines)).toBeCloseTo(inv!.subtotal, 2);
    expect(sumLines(lines)).toBeCloseTo(taxableBase(inv!), 2);
    expect(sumLines(lines)).not.toBeCloseTo(inv!.total, 2);
  });

  /**
   * Adversarial review catch. `recalc.ts` applies `discountPercent` AFTER
   * summing the rows, and `invoices` has no discount column — so a FULL
   * invoice's `subtotal` is the PRE-discount figure while its `total` is
   * post-discount. Without a discount line in the snapshot the Xero push
   * (tax-exclusive `LineAmount`) bills the pre-discount base plus tax on it:
   * a $1000 project at 10% issues by Flow at $990 and arrives in Xero at
   * $1100. Bigger than the INV-260901 overbill this PR started from.
   */
  test("a project discount rides along as its own negative line, so the lines hit the taxable base", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme Events" });
      await ctx.db.insert("projects", {
        id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", clientId: "c1",
        status: "QUOTING", isTemplate: false, taxRate: 10, discountPercent: 10,
        createdAt: NOW, updatedAt: NOW,
        liveVersionId: "v-p1-2",
      });
      await ctx.db.insert("projectVersions", { id: "v-p1-2", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "ACCEPTED",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 1000, lineTotal: 1000,
        versionId: "v-p1-2",
        lineageId: "l1",
      });
    });
    // Recalc first so the project carries real discounted totals.
    await t.run(async (ctx) => {
      const { recalcProjectTotals } = await import("./lib/recalc");
      await recalcProjectTotals(ctx as never, "p1", ORG, 10, NOW);
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    const inv = await getInvoice(t, "i1");
    const lines = await getLines(t, "i1");
    // subtotal 1000 (pre-discount), discount 100, taxable 900, GST 90, total 990.
    expect(inv?.subtotal).toBe(1000);
    expect(inv?.total).toBe(990);
    expect(taxableBase(inv!)).toBe(900);
    const discountLine = lines.find((l) => l.description.startsWith("Discount"));
    expect(discountLine?.lineTotal).toBe(-100);
    // The invariant that actually protects the client's bill.
    expect(sumLines(lines)).toBe(900);
    expect(sumLines(lines)).not.toBe(inv!.subtotal);
  });
});

describe("invoicesWrites — sourceRevision lineage (#1080/#1097)", () => {
  test("createNative stamps the project's live revision at CREATE time", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { revision: 3, liveRevision: 3 });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });

    expect((await getInvoice(t, "i1"))?.sourceRevision).toBe(3);
  });

  test("sourceRevision is never updated by issueNative or voidNative — it survives a void", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { revision: 2, liveRevision: 2 });
      // The invoice will be stamped with sourceRevision 2 (below) — it needs
      // an accepted quote AT that revision to be issuable.
      await ctx.db.insert("quotes", {
        id: "q2", organizationId: ORG, projectId: "p1", version: 2, status: "ACCEPTED",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    // The project moves to a different live revision AFTER the invoice exists —
    // sourceRevision must reflect what it was at CREATE, not whatever's live now.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { revision: 5, liveRevision: 5 });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });
    expect((await getInvoice(t, "i1"))?.sourceRevision).toBe(2);

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.voidNative, {
      id: "i1", orgId: ORG, reason: "Client cancelled the job", actor, auditId: "a3", now: NOW + 1,
    });
    expect((await getInvoice(t, "i1"))?.sourceRevision).toBe(2); // untouched by the void
  });

  test("createCreditNative stamps its OWN sourceRevision — the version live when the credit was cut", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });
    expect((await getInvoice(t, "i1"))?.sourceRevision).toBe(1);

    // A later promote (or any live-revision move) happens before the credit.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { revision: 4, liveRevision: 4 });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createCreditNative, {
      id: "cr1", orgId: ORG, creditForInvoiceId: "i1", actor, auditId: "a3", now: NOW + 1,
    });
    expect((await getInvoice(t, "cr1"))?.sourceRevision).toBe(4); // its OWN moment, not i1's
    expect((await getInvoice(t, "i1"))?.sourceRevision).toBe(1); // the original is untouched
  });
});

async function setRole(t: ReturnType<typeof makeT>, role: string, orgId = ORG, userId = USER) {
  await t.run(async (ctx) => {
    const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId)).first();
    await ctx.db.patch(m!._id, { role });
  });
}

describe("invoicesWrites.deleteVoidNative — the invoice-side accepted-risk erase (#1055)", () => {
  // Always seeded as owner — voidNative (unlike create/issue) requires the
  // owner/admin `void` action, so a role downgrade for the actual permission-
  // under-test has to happen AFTER setup, via setRole below.
  const voidSetup = async (t: ReturnType<typeof makeT>) => {
    await seedMember(t, "owner");
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });
    await t.run(async (ctx) => {
      const inv = await ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "i1")).first();
      await ctx.db.patch(inv!._id, { pdfFileId: "storage_i1" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.voidNative, {
      id: "i1", orgId: ORG, reason: "Data entry error", actor, auditId: "a3", now: NOW + 1,
    });
  };

  const del = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.deleteVoidNative, {
      id: "i1", orgId: ORG, confirmLabel: "INV-2023-0001", actor, auditId: "a4", now: NOW + 2, ...over,
    } as never);

  test("an owner/admin can permanently erase a VOID invoice + its lines with the exact typed label", async () => {
    const t = makeT();
    await voidSetup(t);

    await del(t);
    expect(await getInvoice(t, "i1")).toBeNull();
    expect(await getLines(t, "i1")).toHaveLength(0);
  });

  test("rejects a confirmLabel that doesn't match exactly", async () => {
    const t = makeT();
    await voidSetup(t);

    await expect(del(t, { confirmLabel: "inv-2023-0001" })).rejects.toThrow(/type.*exactly/i);
    expect(await getInvoice(t, "i1")).not.toBeNull();
  });

  test("refuses an invoice that isn't VOID (still ISSUED)", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProjectAndClient(t);
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.createNative, {
      id: "i1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", actor, auditId: "a1", now: NOW,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.invoicesWrites.issueNative, { id: "i1", orgId: ORG, autoNumber, actor, auditId: "a2", now: NOW });

    await expect(del(t, { auditId: "a3", now: NOW + 1 })).rejects.toThrow(/only a void invoice/i);
  });

  test("refuses while the invoice still has a non-voided payment recorded against it", async () => {
    const t = makeT();
    await voidSetup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("payments", {
        id: "pay1", organizationId: ORG, invoiceId: "i1", projectId: "p1", amount: 100, method: "CASH",
        paidAt: NOW, recordedById: USER, createdAt: NOW, updatedAt: NOW,
      });
    });

    await expect(del(t)).rejects.toThrow(/payment\(s\) recorded against it/i);
    expect(await getInvoice(t, "i1")).not.toBeNull();

    // Void the payment, then deletion is allowed.
    await t.withIdentity(asUser(ORG)).mutation(api.paymentsWrites.voidNative, {
      id: "pay1", orgId: ORG, reason: "recorded in error", actor, auditId: "a5", now: NOW + 3,
    });
    await del(t, { auditId: "a6", now: NOW + 4 });
    expect(await getInvoice(t, "i1")).toBeNull();
  });

  test("a manager (lacks invoice:delete) cannot permanently delete a VOID invoice", async () => {
    const t = makeT();
    await voidSetup(t);
    await setRole(t, "manager");

    await expect(del(t)).rejects.toThrow(/forbidden|permission/i);
    expect(await getInvoice(t, "i1")).not.toBeNull();
  });

  test("rejects another org's invoice (IDOR guard)", async () => {
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
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.invoicesWrites.voidNative, {
      id: "i1", orgId: OTHER, reason: "oops", actor: { userId: "user_2", userName: "Bob" }, auditId: "a3", now: NOW + 1,
    });

    await expect(del(t, { confirmLabel: "INV-2023-0001" })).rejects.toThrow(/forbidden|organization mismatch/i);
  });
});
