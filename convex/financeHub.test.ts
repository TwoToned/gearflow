// @vitest-environment node
//
// The Finance hub reads (UX Phase 17, §9j): derived status words, the strip matching the rows,
// the four money words, cross-tenant exclusion, the read bounds, and money ABSENT (never zero,
// never a sort key) for a caller below the job-cost line.
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_A";
const OTHER = "org_B";
const USER = "user_1";
const KEY = "key_1";
const asUser = { subject: USER, orgId: ORG };
const asAgent = { subject: USER, orgId: ORG, akid: KEY };
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T, role = "manager", key?: { noFinancials: boolean }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m", organizationId: ORG, userId: USER, role });
    if (key) {
      await ctx.db.insert("apiKeys", {
        id: KEY, organizationId: ORG, name: "k", prefix: "gf_live_aaaaaa", tokenHash: "h",
        scopes: JSON.stringify(["*"]), isActive: true, actingUserId: USER, createdById: USER, noFinancials: key.noFinancials,
      });
    }
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Hilton", isActive: true });
    await ctx.db.insert("clients", { id: "c2", organizationId: ORG, name: "Deposit Co", isActive: true, paymentProfile: "DEPOSIT_BALANCE", profileDepositPercent: 30 });
    await ctx.db.insert("clients", { id: "cx", organizationId: OTHER, name: "Foreign", isActive: true });
    const project = (id: string, num: string, clientId: string, org = ORG, status = "QUOTED", total = 1000) =>
      ctx.db.insert("projects", { id, organizationId: org, projectNumber: num, name: `Job ${num}`, clientId, status: status as "QUOTED", isTemplate: false, total, revision: 1 });
    await project("p1", "#1001", "c1");
    await project("p2", "#1002", "c1", ORG, "CONFIRMED");
    await project("p3", "#1003", "c2", ORG, "CONFIRMED", 10000); // deposit client, confirmed, no deposit invoice
    await project("px", "#9999", "cx", OTHER);

    const quote = (id: string, projectId: string, status: string, extra: Record<string, unknown> = {}, org = ORG) =>
      ctx.db.insert("quotes", { id, organizationId: org, projectId, version: 1, status: status as "SENT", snapshot: { total: 5000 }, ...extra });
    await quote("q_draft", "p1", "DRAFT");
    await quote("q_sent", "p1", "SENT", { sentAt: NOW - 5 * DAY, validUntil: NOW + 10 * DAY });
    await quote("q_legacy", "p1", "PUBLISHED", { sentAt: NOW - 5 * DAY, validUntil: NOW + 10 * DAY }); // reads as SENT
    await quote("q_expired", "p2", "SENT", { sentAt: NOW - 30 * DAY, validUntil: NOW - 2 * DAY }); // derived EXPIRED, fresh
    await quote("q_old_expired", "p2", "SENT", { sentAt: NOW - 60 * DAY, validUntil: NOW - 20 * DAY }); // expired > 7 days: All only
    await quote("q_acc", "p2", "ACCEPTED", { sentAt: NOW - 9 * DAY, validUntil: NOW + 5 * DAY });
    await quote("q_declined", "p2", "DECLINED");
    await quote("q_foreign", "px", "SENT", { validUntil: NOW + DAY }, OTHER);

    const inv = (id: string, over: Record<string, unknown>, org = ORG) =>
      ctx.db.insert("invoices", {
        id, organizationId: org, projectId: "p2", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 100, taxAmount: 10, total: 110,
        issuedAt: NOW - 3 * DAY, dueDate: NOW + 5 * DAY, ...over,
      } as never);
    await inv("i_draft", { status: "DRAFT", issuedAt: undefined, dueDate: undefined, invoiceNumber: "D-1" });
    await inv("i_issued", { invoiceNumber: "INV-1" });
    await inv("i_part_ok", { invoiceNumber: "INV-2", paymentStatus: "PARTIALLY_PAID", amountPaid: 40 });
    await inv("i_overdue_part", { invoiceNumber: "INV-3", paymentStatus: "PARTIALLY_PAID", amountPaid: 40, dueDate: NOW - 4 * DAY }); // D56: OVERDUE, not Part paid
    await inv("i_paid", { invoiceNumber: "INV-4", paymentStatus: "PAID", amountPaid: 110, dueDate: NOW - 9 * DAY });
    await inv("i_void", { invoiceNumber: "INV-5", status: "VOID" });
    await inv("i_foreign", { invoiceNumber: "X-1", projectId: "px", clientId: "cx" }, OTHER);
  });
}

const page = (t: T, as: typeof asUser, fn: "quotesPage" | "invoicesPage", args: Record<string, unknown> = {}) =>
  t.withIdentity(as).query(api.financeHub[fn], { orgId: ORG, now: NOW, ...args } as never) as Promise<{ items: Record<string, unknown>[]; total: number; truncated: boolean; moneyVisible: boolean }>;
const ids = (r: { items: Record<string, unknown>[] }) => r.items.map((i) => i.id).sort();

describe("quotes: the DERIVED status, never the stored column", () => {
  test("segments", async () => {
    const t = makeT();
    await seed(t);
    expect(ids(await page(t, asUser, "quotesPage", { segment: "draft" }))).toEqual(["q_draft"]);
    expect(ids(await page(t, asUser, "quotesPage", { segment: "sent" }))).toEqual(["q_legacy", "q_sent"]); // PUBLISHED reads as SENT
    expect(ids(await page(t, asUser, "quotesPage", { segment: "accepted" }))).toEqual(["q_acc"]);
    // Expired is derived (validUntil < now && SENT); one past 7 days lives under All only.
    expect(ids(await page(t, asUser, "quotesPage", { segment: "expired" }))).toEqual(["q_expired"]);
    const all = ids(await page(t, asUser, "quotesPage", { segment: "all" }));
    expect(all).toEqual(["q_acc", "q_draft", "q_expired", "q_legacy", "q_old_expired", "q_sent"]);
    expect(all).not.toContain("q_declined"); // closed ones only on request
    expect(ids(await page(t, asUser, "quotesPage", { segment: "all", includeClosed: true }))).toContain("q_declined");
  });

  test("another org's quotes never appear, even by search", async () => {
    const t = makeT();
    await seed(t);
    const r = await page(t, asUser, "quotesPage", { segment: "all", includeClosed: true, search: "Foreign" });
    expect(r.total).toBe(0);
    expect(ids(await page(t, asUser, "quotesPage", { segment: "all", includeClosed: true }))).not.toContain("q_foreign");
  });

  test("search matches job number, job name and client", async () => {
    const t = makeT();
    await seed(t);
    expect((await page(t, asUser, "quotesPage", { segment: "all", search: "1002" })).total).toBe(3);
    expect((await page(t, asUser, "quotesPage", { segment: "all", search: "hilton" })).total).toBe(6);
  });
});

describe("invoices: Overdue outranks Part paid (D56) through the one pill", () => {
  test("segments", async () => {
    const t = makeT();
    await seed(t);
    expect(ids(await page(t, asUser, "invoicesPage", { segment: "draft" }))).toEqual(["i_draft"]);
    expect(ids(await page(t, asUser, "invoicesPage", { segment: "issued" }))).toEqual(["i_issued", "i_part_ok"]);
    expect(ids(await page(t, asUser, "invoicesPage", { segment: "overdue" }))).toEqual(["i_overdue_part"]);
    expect(ids(await page(t, asUser, "invoicesPage", { segment: "paid" }))).toEqual(["i_paid"]);
    const all = ids(await page(t, asUser, "invoicesPage", { segment: "all" }));
    expect(all).not.toContain("i_void");
    expect(ids(await page(t, asUser, "invoicesPage", { segment: "all", includeVoid: true }))).toContain("i_void");
    expect(all).not.toContain("i_foreign");
  });

  test("the part-paid-but-late invoice reads Overdue, with days late and what is still owed", async () => {
    const t = makeT();
    await seed(t);
    const row = (await page(t, asUser, "invoicesPage", { segment: "overdue" })).items[0];
    expect(row.pill).toBe("OVERDUE");
    expect(row.pillLabel).toBe("Overdue");
    expect(row.overdueDays).toBe(4);
    expect(row.outstanding).toBe(70);
  });

  test("Deposit due is the job page's own rule: agreed jobs whose invoicing has NOT started; the client's profile does not gate it", async () => {
    const t = makeT();
    await seed(t);
    const r = (await page(t, asUser, "invoicesPage", { segment: "depositdue" })) as unknown as { kind: string; items: { id: string; amount?: number; depositPercent: number }[] };
    expect(r.kind).toBe("toRaise");
    // p3 (deposit client, 30%) and p2... p2 already carries invoices so is NOT due; p1 is only QUOTED (not agreed).
    expect(r.items.map((i) => i.id)).toEqual(["p3"]);
    expect(r.items[0].amount).toBe(3000); // 30% of 10,000
    // A FULL_UPFRONT (no profile) client's agreed, uninvoiced job is due too: the profile only supplies the default %.
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p4", organizationId: ORG, projectNumber: "#1004", name: "Job #1004", clientId: "c1", status: "CONFIRMED", isTemplate: false, total: 4000, revision: 1 });
    });
    const again = (await page(t, asUser, "invoicesPage", { segment: "depositdue" })) as unknown as { items: { id: string; depositPercent: number; amount?: number }[] };
    expect(again.items.map((i) => i.id).sort()).toEqual(["p3", "p4"]);
    expect(again.items.find((i) => i.id === "p4")).toMatchObject({ depositPercent: 25, amount: 1000 }); // the default 25%
  });

  test("a job with MORE invoices than the read covers is unknown, never shown as a confident Deposit due, and the count is a floor", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p_many", organizationId: ORG, projectNumber: "#2000", name: "Busy", clientId: "c1", status: "CONFIRMED", isTemplate: false, total: 100, revision: 1 });
      for (let i = 0; i < 9; i++) {
        await ctx.db.insert("invoices", { id: `many_${i}`, organizationId: ORG, projectId: "p_many", clientId: "c1", kind: "DEPOSIT", status: "DRAFT", subtotal: 1, taxAmount: 0, total: 1 } as never);
      }
    });
    const r = (await page(t, asUser, "invoicesPage", { segment: "depositdue" })) as unknown as { items: { id: string }[]; truncated: boolean };
    expect(r.items.map((i) => i.id)).not.toContain("p_many");
    expect(r.truncated).toBe(true);
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.approx.depositdue).toBe(true);
  });

  test("an invoice belonging to ANOTHER org's job is not used to decide this org's Deposit due", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", { id: "i_foreign_p3", organizationId: OTHER, projectId: "p3", clientId: "cx", kind: "DEPOSIT", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 1 } as never);
    });
    const r = (await page(t, asUser, "invoicesPage", { segment: "depositdue" })) as unknown as { items: { id: string }[] };
    expect(r.items.map((i) => i.id)).toContain("p3");
  });
});

describe("hubCounts: the strip, the head words and the money words", () => {
  test("counts agree with the pages, and the money words are derived", async () => {
    const t = makeT();
    await seed(t);
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.quotes).toEqual({ all: 6, draft: 1, sent: 2, accepted: 1, expired: 1 });
    expect(c.invoices).toEqual({ all: 5, draft: 1, depositdue: 1, issued: 2, paid: 1, overdue: 1 });
    // Quoted = live SENT quotes (2 x 5000); Awaiting = owed on issued, not overdue (110 + 70); Overdue = owed past due (70);
    // Invoiced this month = issued this month (4 non-draft, non-void invoices x 110).
    expect(c.money).toEqual({ quoted: 10000, awaitingPayment: 180, overdue: 70, invoicedThisMonth: 440 });
    expect(c.truncated).toBe(false);
    expect(c.approx.words).toEqual({ quoted: false, awaitingPayment: false, overdue: false, invoicedThisMonth: false });
  });
});

describe("money is ABSENT below the job-cost line, never zero and never a sort key", () => {
  test("a noFinancials key gets no totals, no outstanding, no money words", async () => {
    const t = makeT();
    await seed(t, "manager", { noFinancials: true });
    const q = await page(t, asAgent, "quotesPage", { segment: "all" });
    const i = await page(t, asAgent, "invoicesPage", { segment: "all" });
    expect(q.moneyVisible).toBe(false);
    for (const row of [...q.items, ...i.items]) {
      expect("total" in row).toBe(false);
      expect("outstanding" in row).toBe(false);
    }
    const c = (await t.withIdentity(asAgent).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect("money" in c).toBe(false);
    const raw = JSON.stringify([q, i, c]);
    expect(raw).not.toMatch(/"(outstanding|amount|money)"/);
    expect(raw).not.toMatch(/5000|110|10000/); // SENTINEL: no frozen total or invoice total leaks anywhere
    const dep = await page(t, asAgent, "invoicesPage", { segment: "depositdue" });
    expect(dep.items.every((r) => !("amount" in r))).toBe(true);
  });

  test("a hidden money column is not a sort key: sorting by total falls back to the default order", async () => {
    const t = makeT();
    await seed(t, "manager", { noFinancials: true });
    const byTotal = await page(t, asAgent, "invoicesPage", { segment: "all", sortBy: "total", sortOrder: "desc" });
    const byDefault = await page(t, asAgent, "invoicesPage", { segment: "all" });
    expect(byTotal.items.map((r) => r.id)).toEqual(byDefault.items.map((r) => r.id));
  });

  test("a role that may see money can sort by it", async () => {
    const t = makeT();
    await seed(t);
    const r = await page(t, asUser, "invoicesPage", { segment: "all", sortBy: "total", sortOrder: "desc" });
    expect(r.moneyVisible).toBe(true);
    expect(r.items.every((row) => typeof row.total === "number")).toBe(true);
  });
});

describe("a caller from another org is refused", () => {
  test("every hub read rejects a mismatched org", async () => {
    const t = makeT();
    await seed(t);
    const stranger = { subject: "stranger", orgId: OTHER };
    await expect(t.withIdentity(stranger).query(api.financeHub.quotesPage, { orgId: ORG })).rejects.toThrow();
    await expect(t.withIdentity(stranger).query(api.financeHub.invoicesPage, { orgId: ORG })).rejects.toThrow();
    await expect(t.withIdentity(stranger).query(api.financeHub.hubCounts, { orgId: ORG })).rejects.toThrow();
  });
});

describe("a row that points at ANOTHER org's project never leaks it (R-8.4.3)", () => {
  test("the project and client are read by cuid, so the org check is what keeps them out", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "i_xref", organizationId: ORG, projectId: "px", clientId: "cx", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 1,
        invoiceNumber: "XREF-1", issuedAt: NOW - DAY, dueDate: NOW + DAY,
      } as never);
      await ctx.db.insert("quotes", { id: "q_xref", organizationId: ORG, projectId: "px", version: 1, status: "SENT", snapshot: { total: 1 }, validUntil: NOW + DAY });
    });
    const inv = await page(t, asUser, "invoicesPage", { segment: "issued" });
    const q = await page(t, asUser, "quotesPage", { segment: "sent" });
    expect(inv.items.find((r) => r.id === "i_xref")!.project).toBeNull();
    expect(q.items.find((r) => r.id === "q_xref")!.project).toBeNull();
    expect(JSON.stringify([inv, q])).not.toMatch(/9999|Foreign/);
  });
});

describe("bounds", () => {
  test("a status scan keeps the NEWEST rows and says truncated when its cap bites", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 320; i++) {
        await ctx.db.insert("invoices", {
          id: `bulk_${i}`, organizationId: ORG, projectId: "p2", clientId: "c1", kind: "FULL", status: "DRAFT", subtotal: 1, taxAmount: 0, total: 1,
          invoiceNumber: `B-${i}`,
        } as never);
      }
    });
    const r = await page(t, asUser, "invoicesPage", { segment: "draft", pageSize: 100 });
    expect(r.truncated).toBe(true);
    expect(r.total).toBeLessThanOrEqual(300 + 1); // the cap (300) plus the one seeded draft
    // The cap keeps the NEWEST (org and order in the index, then the cap): the last one inserted is in, the first is out.
    const all = await page(t, asUser, "invoicesPage", { segment: "draft", pageSize: 100, search: "B-319" });
    expect(all.total).toBe(1);
    expect((await page(t, asUser, "invoicesPage", { segment: "draft", pageSize: 100, search: "B-0" })).items.some((i) => i.invoiceNumber === "B-0")).toBe(false);
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.truncated).toBe(true);
  });
});

describe("the ISSUED read is capped, and a cut one never prints a confident number", () => {
  test("301+ issued: the OLDEST (long-overdue) rows are cut, so overdue / awaiting are flagged as a floor", async () => {
    const t = makeT();
    await seed(t);
    const { ISSUED_CAP } = await import("./financeHub");
    await t.run(async (ctx) => {
      // The oldest rows are the overdue ones; newer ones are paid (paid invoices stay ISSUED forever).
      for (let i = 0; i < ISSUED_CAP + 5; i++) {
        const overdue = i < 5;
        await ctx.db.insert("invoices", {
          id: `cap_${i}`, organizationId: ORG, projectId: "p2", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 100,
          invoiceNumber: `C-${i}`, issuedAt: NOW - 60 * DAY, dueDate: overdue ? NOW - 30 * DAY : NOW + DAY,
          ...(overdue ? {} : { paymentStatus: "PAID", amountPaid: 100 }),
        } as never);
      }
    });
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.truncated).toBe(true);
    expect(c.approx.invoices).toBe(true);
    expect(c.approx.words.overdue).toBe(true);
    expect(c.approx.words.awaitingPayment).toBe(true);
    // The five overdue ones are the oldest and were cut: the figure is too low, and it says so rather than being confident.
    expect(c.invoices.overdue).toBeLessThan(5 + 1);
    const r = await page(t, asUser, "invoicesPage", { segment: "overdue" });
    expect(r.truncated).toBe(true);
  });

  test("an uncut read is NOT flagged", async () => {
    const t = makeT();
    await seed(t);
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.approx.invoices).toBe(false);
    expect(c.approx.quotes).toBe(false);
  });

  test("the quote cap is flagged the same way", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 160; i++) {
        await ctx.db.insert("quotes", { id: `qcap_${i}`, organizationId: ORG, projectId: "p1", version: 1, status: "SENT", snapshot: { total: 1 }, validUntil: NOW + 20 * DAY });
      }
    });
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.approx.quotes).toBe(true);
    expect(c.approx.words.quoted).toBe(true);
  });
});

describe("creation order is not issue order: a cut ISSUED scan flags 'this month' too", () => {
  test("an old-created invoice issued THIS month can be among the cut rows, so invoicedThisMonth is a floor whenever the scan is cut", async () => {
    const t = makeT();
    await seed(t);
    const { ISSUED_CAP } = await import("./financeHub");
    await t.run(async (ctx) => {
      // Inserted FIRST (so oldest `_creationTime`, the first to be cut) but issued today.
      await ctx.db.insert("invoices", { id: "old_created", organizationId: ORG, projectId: "p2", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 5000, invoiceNumber: "OLD-1", issuedAt: NOW - 1000, dueDate: NOW + DAY } as never);
      for (let i = 0; i < ISSUED_CAP + 2; i++) {
        await ctx.db.insert("invoices", { id: `later_${i}`, organizationId: ORG, projectId: "p2", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 1, invoiceNumber: `L-${i}`, issuedAt: NOW - 90 * DAY, dueDate: NOW - 60 * DAY, paymentStatus: "PAID", amountPaid: 1 } as never);
      }
    });
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.approx.words.invoicedThisMonth).toBe(true);
  });
});

describe("read margin: the worst case stays well under Convex's 16,384 doc-scan limit", () => {
  test("fixed scans + the budget, and the per-job reserve matches what take() can read", async () => {
    const m = await import("./financeHub");
    const fixed = 6 * (m.QUOTE_STATUS_CAP + 1) + (m.ISSUED_CAP + 1) + 2 * (m.OTHER_INVOICE_CAP + 1) + 8 * (m.CANDIDATE_JOB_CAP + 1) + 1;
    expect(fixed + m.READ_BUDGET).toBeLessThan(12_000);
    // take(n + 1) can scan n + 1 docs, so the reserve is n + 1 (it was n: an over-read of one per job).
    expect(m.JOB_INVOICES_TAKE).toBe(9);
  });
});

describe("the candidate-job cap is flagged", () => {
  test("more agreed jobs than the per-status cap: Deposit due is a floor", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 152; i++) {
        await ctx.db.insert("projects", { id: `cj_${i}`, organizationId: ORG, projectNumber: `#C${i}`, name: `Cand ${i}`, clientId: "c1", status: "CONFIRMED", isTemplate: false, total: 10, revision: 1 });
      }
    });
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW }))!;
    expect(c.approx.depositdue).toBe(true);
    const r = (await page(t, asUser, "invoicesPage", { segment: "depositdue", pageSize: 100 })) as unknown as { truncated: boolean };
    expect(r.truncated).toBe(true);
  });
});

describe("Invoiced this month uses the ORG's timezone", () => {
  test("at an AU month boundary, 00:10 on 1 Dec Sydney counts as December though it is 30 Nov in UTC", async () => {
    const NOW_AU = Date.UTC(2026, 10, 30, 13, 30); // 00:30 on 1 Dec in Sydney
    vi.setSystemTime(NOW_AU);
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", { organizationId: ORG, settings: JSON.stringify({ timezone: "Australia/Sydney" }), updatedAt: 0 } as never);
      await ctx.db.insert("invoices", { id: "i_dec", organizationId: ORG, projectId: "p2", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 1000, invoiceNumber: "DEC-1", issuedAt: Date.UTC(2026, 10, 30, 13, 10), dueDate: NOW_AU + 9 * DAY } as never);
      await ctx.db.insert("invoices", { id: "i_nov", organizationId: ORG, projectId: "p2", clientId: "c1", kind: "FULL", status: "ISSUED", subtotal: 1, taxAmount: 0, total: 7, invoiceNumber: "NOV-1", issuedAt: Date.UTC(2026, 10, 30, 12, 50), dueDate: NOW_AU + 9 * DAY } as never);
    });
    const c = (await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW_AU }))!;
    expect(c.timezone).toBe("Australia/Sydney");
    // Only the invoice issued after local midnight is "this month"; the other seeded ones (issued days ago) are November.
    expect(c.money!.invoicedThisMonth).toBe(1000);
  });
});

describe("a role without invoice read gets nothing (callerMayRead on top of the org match)", () => {
  test("pages are empty and the counts are null, with no money", async () => {
    const t = makeT();
    await seed(t, "nobody-role");
    const q = await page(t, asUser, "quotesPage", { segment: "all" });
    const i = await page(t, asUser, "invoicesPage", { segment: "all" });
    expect(q.total).toBe(0);
    expect(i.total).toBe(0);
    expect(q.moneyVisible).toBe(false);
    expect(await t.withIdentity(asUser).query(api.financeHub.hubCounts, { orgId: ORG, now: NOW })).toBeNull();
  });
});

describe("a project's client is org-checked too (the cuid read is global)", () => {
  test("a job whose clientId points at ANOTHER org's client shows no client name", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p_x", organizationId: ORG, projectNumber: "#7000", name: "Cross", clientId: "cx", status: "QUOTED", isTemplate: false, total: 1, revision: 1 });
      await ctx.db.insert("quotes", { id: "q_x", organizationId: ORG, projectId: "p_x", version: 1, status: "SENT", snapshot: { total: 1 }, validUntil: NOW + DAY });
    });
    const r = await page(t, asUser, "quotesPage", { segment: "sent" });
    const row = r.items.find((x) => x.id === "q_x") as { project: { clientName: string | null; projectNumber: string } };
    expect(row.project.projectNumber).toBe("#7000");
    expect(row.project.clientName).toBeNull();
    expect(JSON.stringify(r)).not.toContain("Foreign");
  });
});
