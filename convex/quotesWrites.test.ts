// @vitest-environment node
//
// convex/quotesWrites.ts — quote publish/supersede. Verifies: server-computed
// snapshot money (never client-supplied), versioning + supersede-on-republish,
// the RBAC + lifecycle-lock guards, and cross-tenant IDOR protection on
// projectId (R-8.4.3 — every doc fetched by global index must be org-checked).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
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

async function seedProject(t: ReturnType<typeof makeT>, orgId = ORG, status = "QUOTING") {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "P1", name: "Gig",
      status, isTemplate: false, subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 100, lineTotal: 100,
    });
  });
}

const getQuotes = (t: ReturnType<typeof makeT>) => t.run(async (ctx) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect());

describe("quotesWrites.publishNative", () => {
  test("publishes v1 with a server-computed snapshot (never trusts client money)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    const result = await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.publishNative, {
      id: "q1", organizationId: ORG, projectId: "p1", notes: "Valid 30 days", actor, auditId: "a1", now: NOW,
    });
    expect(result.version).toBe(1);

    const quotes = await getQuotes(t);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.status).toBe("PUBLISHED");
    const snapshot = quotes[0]?.snapshot as { lines: { description: string; lineTotal: number }[]; total: number };
    expect(snapshot.total).toBe(110); // from the project's OWN recalc-owned total, not client input
    expect(snapshot.lines.some((l) => l.description === "PA System" && l.lineTotal === 100)).toBe(true);
  });

  test("republishing supersedes the prior PUBLISHED quote and bumps the version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.publishNative, {
      id: "q1", organizationId: ORG, projectId: "p1", actor, auditId: "a1", now: NOW,
    });
    const second = await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.publishNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    expect(second.version).toBe(2);

    const quotes = await getQuotes(t);
    const v1 = quotes.find((q) => q.id === "q1");
    const v2 = quotes.find((q) => q.id === "q2");
    expect(v1?.status).toBe("SUPERSEDED");
    expect(v2?.status).toBe("PUBLISHED");
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER); // project belongs to a DIFFERENT org

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.publishNative, {
        id: "q1", organizationId: ORG, projectId: "p1", actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/not found in your organization/i);
  });

  test("a viewer is denied (invoice:publish)", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.publishNative, {
        id: "q1", organizationId: ORG, projectId: "p1", actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/insufficient permissions/i);
  });

  test("a FINANCE_LOCKED project (CONFIRMED+) without an open unlock session is rejected", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProject(t, ORG, "CONFIRMED");
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.publishNative, {
        id: "q1", organizationId: ORG, projectId: "p1", actor, auditId: "a1", now: NOW,
      }),
    ).rejects.toThrow(/financials.*locked/i);
  });
});
