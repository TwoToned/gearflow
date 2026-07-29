// @vitest-environment node
//
// convex/quotesWrites.ts — the five quote-revision verbs (#986). Verifies the
// four server-enforced invariants (one row per revision, one draft, one live
// document, monotonic revision), supersede-on-SEND-not-on-draft, the recall
// round trip, derived-EXPIRED behaviour, server-computed snapshot money (never
// client-supplied), RBAC per verb (incl. recall's narrower audience), and
// cross-tenant IDOR protection on every mutation (R-8.4.3 — every doc fetched by
// a global index must be org-checked).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
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

async function seedProject(t: ReturnType<typeof makeT>, orgId = ORG, status: Doc<"projects">["status"] = "QUOTING") {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status, isTemplate: false, revision: 1,
      subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 100, lineTotal: 100,
    });
  });
}

const getQuotes = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect());
const getProject = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());

const sendArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "q1", organizationId: ORG, projectId: "p1", quoteDate: NOW, actor, auditId: "a1", now: NOW, ...over,
});

/** Send the current revision, returning the created/updated quote id. */
async function send(t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) {
  return await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.sendNative, sendArgs(over) as never);
}

describe("quotesWrites.sendNative", () => {
  test("sends v1 with a server-computed snapshot (never trusts client money)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    const result = await send(t, { notes: "Valid 30 days" });
    expect(result.version).toBe(1);

    const quotes = await getQuotes(t);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.status).toBe("SENT");
    expect(quotes[0]?.sentById).toBe(USER);
    const snapshot = quotes[0]?.snapshot as { lines: { description: string; lineTotal: number }[]; total: number };
    expect(snapshot.total).toBe(110); // the project's OWN recalc-owned total, not client input
    expect(snapshot.lines.some((l) => l.description === "PA System" && l.lineTotal === 100)).toBe(true);
  });

  test("stamps validUntil from quoteDate + validityDays and captures a QUOTE_SENT snapshot", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    const result = await send(t, { validityDays: 14 });
    // End of the 14th day after the quote date (UTC — no org timezone configured).
    expect(result.validUntil).toBe(Date.UTC(2023, 10, 28, 23, 59, 59, 999));

    const snapshots = await t.run(async (ctx) => ctx.db.query("projectSnapshots").collect());
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.reason).toBe("QUOTE_SENT");
    expect(snapshots[0]?.revision).toBe(1);

    const quotes = await getQuotes(t);
    expect(quotes[0]?.snapshotId).toBe(snapshots[0]?.id);
  });

  test("falls back to the org's configured quoteValidityDays", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", {
        organizationId: ORG,
        settings: JSON.stringify({ documents: { quoteValidityDays: 7 } }),
      });
    });

    const result = await send(t);
    expect(result.validUntil).toBe(Date.UTC(2023, 10, 21, 23, 59, 59, 999));
    const quotes = await getQuotes(t);
    expect(quotes[0]?.validityDays).toBe(7);
  });

  test("offers QUOTED from ENQUIRY/QUOTING but never applies it itself", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, "QUOTING");

    const result = await send(t);
    expect(result.offerStatusChange).toBe("QUOTED");
    expect((await getProject(t))?.status).toBe("QUOTING"); // NOT forced
  });

  test("re-sending an already-sent revision is rejected — cut a new version instead", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    await expect(send(t, { id: "q2", auditId: "a2", now: NOW + 1 })).rejects.toThrow(/already been sent/i);
  });

  test("rejects a recipient contact belonging to another client", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { clientId: "c1" });
      await ctx.db.insert("clientContacts", { id: "ct1", organizationId: ORG, clientId: "c_other", name: "Bob" });
    });

    await expect(send(t, { recipientContactId: "ct1" })).rejects.toThrow(/client contact not found/i);
  });

  test("supersedes an ACCEPTED revision too — acceptance doesn't survive a re-quote", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.markAcceptedNative, {
      id: "q1", organizationId: ORG, actor, auditId: "a2", now: NOW + 1,
    });
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a3", now: NOW + 2,
    });
    // v1 is STILL accepted while v2 is only a draft — cutting a draft never
    // invalidates what the client agreed to.
    let state = await t
      .withIdentity(asUser(ORG))
      .query(api.quotes.revisionStateForProject, { orgId: ORG, projectId: "p1", now: NOW + 2 });
    expect(state.hasAcceptedQuote).toBe(true);

    await send(t, { id: "ignored", auditId: "a4", now: NOW + 3 });

    // …but once v2 actually goes out, v1 is no longer the deal. The project
    // needs v2 accepted (or an admin override) before it can confirm again —
    // the pricing the client agreed to has changed.
    state = await t
      .withIdentity(asUser(ORG))
      .query(api.quotes.revisionStateForProject, { orgId: ORG, projectId: "p1", now: NOW + 3 });
    expect(state.hasAcceptedQuote).toBe(false);
    expect((await getQuotes(t)).find((q) => q.id === "q1")?.status).toBe("SUPERSEDED");
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER); // project belongs to a DIFFERENT org

    await expect(send(t)).rejects.toThrow(/not found in your organization/i);
  });

  test("a viewer is denied (invoice:publish)", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await seedProject(t);
    await expect(send(t)).rejects.toThrow(/insufficient permissions/i);
  });

  test("a FINANCE_LOCKED project (CONFIRMED+) without an open unlock session is rejected", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProject(t, ORG, "CONFIRMED");
    await expect(send(t)).rejects.toThrow(/financials.*locked/i);
  });

  test("mirrors its Zod bounds server-side (notes + validityDays)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    await expect(send(t, { notes: "x".repeat(2001) })).rejects.toThrow(/at most 2000/i);
    await expect(send(t, { validityDays: 0 })).rejects.toThrow(/at least 1/i);
    await expect(send(t, { validityDays: 400 })).rejects.toThrow(/at most 365/i);
    await expect(send(t, { validityDays: 1.5 })).rejects.toThrow(/whole number/i);
  });
});

describe("quotesWrites.newVersionNative — monotonicity and the one-draft invariant", () => {
  test("increments projects.revision and opens a DRAFT, leaving the sent revision alone", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    const result = await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    expect(result.version).toBe(2);
    expect((await getProject(t))?.revision).toBe(2);

    const quotes = await getQuotes(t);
    // SUPERSEDE FIRES ON SEND, NOT ON DRAFT — v1 is still the client's document.
    expect(quotes.find((q) => q.id === "q1")?.status).toBe("SENT");
    expect(quotes.find((q) => q.id === "q2")?.status).toBe("DRAFT");
    expect(quotes.find((q) => q.id === "q2")?.snapshot).toBeNull();
  });

  test("v1 flips to SUPERSEDED only when v2 is actually sent", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    await send(t, { id: "ignored", auditId: "a3", now: NOW + 2 });

    const quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "q1")?.status).toBe("SUPERSEDED");
    expect(quotes.find((q) => q.id === "q1")?.supersededByQuoteId).toBe("q2");
    expect(quotes.find((q) => q.id === "q2")?.status).toBe("SENT");
    // Exactly one row per revision — the send reused the existing v2 draft rather
    // than inserting a second row at version 2.
    expect(quotes.filter((q) => q.version === 2)).toHaveLength(1);
  });

  test("refuses to cut a second draft while one is open", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
        id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW,
      }),
    ).rejects.toThrow(/hasn't been sent yet/i);
  });

  test("revision is never decremented or reused — a recalled-then-re-sent revision keeps its number", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: ORG, reason: "Wrong rental window", actor, auditId: "a2", now: NOW + 1,
    });
    const resent = await send(t, { auditId: "a3", now: NOW + 2 });

    expect(resent.version).toBe(1);
    expect((await getProject(t))?.revision).toBe(1);
    expect(await getQuotes(t)).toHaveLength(1);
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
        id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW,
      }),
    ).rejects.toThrow(/not found in your organization/i);
  });
});

describe("quotesWrites.deleteDraftNative", () => {
  const del = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.deleteDraftNative, {
      id: "q1", organizationId: ORG, actor, auditId: "a2", now: NOW + 1, ...over,
    } as never);

  test("deletes a v1 draft that was never sent — nothing to roll back to but 1", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    // Simulate a v1 draft row existing (e.g. from backfill) without ever sending it.
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "DRAFT",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });

    const result = await del(t);
    expect(result.deletedVersion).toBe(1);
    expect(result.revision).toBe(1);
    expect(await getQuotes(t)).toHaveLength(0);
    expect((await getProject(t))?.revision).toBe(1);
  });

  test("deletes a fat-fingered v2 draft — rolls the counter back to v1, which stays SENT", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    expect((await getProject(t))?.revision).toBe(2);

    const result = await del(t, { id: "q2", auditId: "a3", now: NOW + 2 });
    expect(result.deletedVersion).toBe(2);
    expect(result.revision).toBe(1);

    const quotes = await getQuotes(t);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.id).toBe("q1");
    expect(quotes[0]?.status).toBe("SENT");
    expect((await getProject(t))?.revision).toBe(1);

    // The freed number is reusable — a fresh "new version" becomes v2 again.
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q3", organizationId: ORG, projectId: "p1", actor, auditId: "a4", now: NOW + 3,
    });
    expect((await getProject(t))?.revision).toBe(2);
  });

  test("rolls back to the highest EVER-sent revision, not just the immediately preceding one", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t); // v1 sent
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    await send(t, { id: "ignored", auditId: "a3", now: NOW + 2 }); // v2 sent, supersedes v1
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q3", organizationId: ORG, projectId: "p1", actor, auditId: "a4", now: NOW + 3,
    });
    expect((await getProject(t))?.revision).toBe(3);

    const result = await del(t, { id: "q3", auditId: "a5", now: NOW + 4 });
    expect(result.revision).toBe(2); // not 1 — v2 is the highest revision that was ever sent
    expect((await getProject(t))?.revision).toBe(2);
    expect((await getQuotes(t)).find((q) => q.id === "q2")?.status).toBe("SENT");
  });

  test("refuses to delete a quote that was ever sent, even if currently recalled back to DRAFT", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: ORG, reason: "Wrong rental window", actor, auditId: "a2", now: NOW + 1,
    });
    expect((await getQuotes(t))[0]?.status).toBe("DRAFT"); // recalled — currently a draft

    await expect(del(t, { auditId: "a3", now: NOW + 2 })).rejects.toThrow(/was sent at some point.*recall/i);
    expect(await getQuotes(t)).toHaveLength(1); // untouched
  });

  test("refuses to delete a SENT or ACCEPTED quote directly", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    await expect(del(t, { auditId: "a2" })).rejects.toThrow(/is sent/i);
  });

  test("a viewer is denied (invoice:publish)", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "DRAFT",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });

    await expect(del(t)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects another org's quote (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: OTHER, projectId: "p1", version: 1, status: "DRAFT",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });

    await expect(del(t)).rejects.toThrow(/quote not found/i);
  });
});

describe("quotesWrites.recallNative", () => {
  const recall = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: ORG, reason: "Wrong rental window", actor, auditId: "a2", now: NOW + 1, ...over,
    } as never);

  test("round trip: SENT → DRAFT, keeping the row and its send history", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    await recall(t);
    const quotes = await getQuotes(t);
    expect(quotes[0]?.status).toBe("DRAFT");
    expect(quotes[0]?.recallReason).toBe("Wrong rental window");
    expect(quotes[0]?.recalledById).toBe(USER);
    // Never deleted — the client may already be holding the document.
    expect(quotes[0]?.sentAt).toBe(NOW);
  });

  test("unlinks (never discards) the attached artifact, forcing the next send through a real render (#1027)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    // Simulate the server action having attached a rendered PDF at send time.
    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      await ctx.db.patch(quote!._id, { pdfFileId: "storage_v1" });
    });

    await recall(t);
    const [recalled] = await getQuotes(t);
    expect(recalled?.pdfFileId).toBeFalsy();
    expect(recalled?.recalledPdfFileIds).toEqual(["storage_v1"]);

    // Resend the same revision (e.g. after fixing notes/discount) — the guard
    // in attachQuoteArtifact only refuses when pdfFileId is already set, so a
    // fresh render can now actually attach instead of being silently skipped.
    await send(t, { auditId: "a3", now: NOW + 2, notes: "Corrected notes" });
    const afterResend = await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      return quote!;
    });
    // sendNative itself never attaches (that's attachQuoteArtifact's job) —
    // this confirms the guard is unblocked, not bypassed: pdfFileId is still
    // unset after the resend, ready for a real render to attach fresh bytes.
    expect(afterResend.pdfFileId).toBeFalsy();

    // Recalling a second time preserves BOTH prior artifacts, never overwriting.
    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      await ctx.db.patch(quote!._id, { pdfFileId: "storage_v1_corrected" });
    });
    await recall(t, { auditId: "a4", now: NOW + 3 });
    const [recalledAgain] = await getQuotes(t);
    expect(recalledAgain?.recalledPdfFileIds).toEqual(["storage_v1", "storage_v1_corrected"]);
  });

  test("restores the revision this send superseded", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    await send(t, { id: "ignored", auditId: "a3", now: NOW + 2 });

    const result = await recall(t, { id: "q2", auditId: "a4", now: NOW + 3 });
    expect(result.restoredQuoteId).toBe("q1");

    const quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "q1")?.status).toBe("SENT");
    expect(quotes.find((q) => q.id === "q1")?.supersededByQuoteId).toBeUndefined();
    expect(quotes.find((q) => q.id === "q2")?.status).toBe("DRAFT");
  });

  test("a manager can send but CANNOT recall; the project's PM can", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProject(t);
    await send(t); // manager sends fine — invoice:publish

    await expect(recall(t)).rejects.toThrow(/admins.*owners.*PM/i);

    // Same manager, now an assigned PM on this project.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER });
    });
    await recall(t, { auditId: "a5" });
    expect((await getQuotes(t))[0]?.status).toBe("DRAFT");
  });

  test("requires a bounded reason (reuses #793's 10-char floor)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    await expect(recall(t, { reason: "typo" })).rejects.toThrow(/at least 10/i);
    await expect(recall(t, { reason: "x".repeat(1001) })).rejects.toThrow(/at most 1000/i);
  });

  test("cannot recall a draft or an accepted revision", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.markAcceptedNative, {
      id: "q1", organizationId: ORG, actor, auditId: "a2", now: NOW + 1,
    });

    await expect(recall(t, { auditId: "a3" })).rejects.toThrow(/is accepted/i);
  });

  test("rejects another org's quote (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.quotesWrites.sendNative, {
      id: "q1", organizationId: OTHER, projectId: "p1", quoteDate: NOW,
      actor: { userId: "user_2", userName: "Bob" }, auditId: "a1", now: NOW,
    });

    await expect(recall(t)).rejects.toThrow(/quote not found/i);
  });

  test("refuses to recall a protected quote (#1030)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
      id: "q1", organizationId: ORG, protect: true, actor, auditId: "a2", now: NOW + 1,
    });

    await expect(recall(t, { auditId: "a3", now: NOW + 2 })).rejects.toThrow(/protected/i);
    expect((await getQuotes(t))[0]?.status).toBe("SENT"); // untouched

    // Unprotecting clears the way again.
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
      id: "q1", organizationId: ORG, protect: false, actor, auditId: "a4", now: NOW + 3,
    });
    await recall(t, { auditId: "a5", now: NOW + 4 });
    expect((await getQuotes(t))[0]?.status).toBe("DRAFT");
  });
});

describe("quotesWrites.setQuoteProtectedNative", () => {
  test("an owner can protect and unprotect", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t);

    const on = await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
      id: "q1", organizationId: ORG, protect: true, actor, auditId: "a2", now: NOW + 1,
    });
    expect(on.protected).toBe(true);
    let [quote] = await getQuotes(t);
    expect(quote?.protected).toBe(true);
    expect(quote?.protectedById).toBe(USER);

    const off = await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
      id: "q1", organizationId: ORG, protect: false, actor, auditId: "a3", now: NOW + 2,
    });
    expect(off.protected).toBe(false);
    [quote] = await getQuotes(t);
    expect(quote?.protected).toBe(false);
    expect(quote?.protectedById).toBeFalsy();
  });

  test("an admin — even though admin passes isHardLockOverrideAllowed — is NOT owner-only", async () => {
    const t = makeT();
    await seedMember(t, "admin");
    await seedProject(t);
    await send(t);

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
        id: "q1", organizationId: ORG, protect: true, actor, auditId: "a2", now: NOW + 1,
      }),
    ).rejects.toThrow(/only an org owner/i);
  });

  test("a manager is denied", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProject(t);
    await send(t);

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
        id: "q1", organizationId: ORG, protect: true, actor, auditId: "a2", now: NOW + 1,
      }),
    ).rejects.toThrow(/only an org owner/i);
  });

  test("accepting a quote auto-protects it", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t);

    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.markAcceptedNative, {
      id: "q1", organizationId: ORG, actor, auditId: "a2", now: NOW + 1,
    });

    const [quote] = await getQuotes(t);
    expect(quote?.status).toBe("ACCEPTED");
    expect(quote?.protected).toBe(true);
    expect(quote?.protectedById).toBe(USER);
  });

  test("rejects another org's quote (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.quotesWrites.sendNative, {
      id: "q1", organizationId: OTHER, projectId: "p1", quoteDate: NOW,
      actor: { userId: "user_2", userName: "Bob" }, auditId: "a1", now: NOW,
    });

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
        id: "q1", organizationId: ORG, protect: true, actor, auditId: "a2", now: NOW + 1,
      }),
    ).rejects.toThrow(/quote not found/i);
  });
});

describe("quotesWrites.deleteRecalledNative — recall-then-delete, the one full-erase path (#1029)", () => {
  const recallThenDeleteSetup = async (t: ReturnType<typeof makeT>) => {
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t);
    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      await ctx.db.patch(quote!._id, { pdfFileId: "storage_v1" });
    });
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: ORG, reason: "Client requested full removal", actor, auditId: "a2", now: NOW + 1,
    });
  };

  const del = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.deleteRecalledNative, {
      id: "q1", organizationId: ORG, confirmLabel: "RVLT-2026-0087 v1", actor, auditId: "a3", now: NOW + 2, ...over,
    } as never);

  test("an owner can permanently erase a recalled, previously-sent quote with the exact typed label", async () => {
    const t = makeT();
    await recallThenDeleteSetup(t);

    const result = await del(t);
    expect(result.deletedVersion).toBe(1);
    expect(result.revision).toBe(1); // nothing else was ever sent — falls back to 1
    expect(await getQuotes(t)).toHaveLength(0);
    expect((await getProject(t))?.revision).toBe(1);
  });

  test("rejects a confirmLabel that doesn't match exactly — no silent 'close enough'", async () => {
    const t = makeT();
    await recallThenDeleteSetup(t);

    await expect(del(t, { confirmLabel: "RVLT-2026-0087 V1" })).rejects.toThrow(/type.*exactly/i);
    await expect(del(t, { confirmLabel: "RVLT-2026-0087 v1 " })).rejects.toThrow(/type.*exactly/i);
    expect(await getQuotes(t)).toHaveLength(1); // untouched by the failed attempts
  });

  test("refuses a quote that hasn't been recalled yet (still SENT)", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t);

    await expect(del(t, { auditId: "a2", now: NOW + 1 })).rejects.toThrow(/is sent/i);
    expect(await getQuotes(t)).toHaveLength(1);
  });

  test("refuses a never-sent draft — that's deleteDraftNative's job", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "DRAFT",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });

    await expect(
      del(t, { confirmLabel: "RVLT-2026-0087 v1", auditId: "a2", now: NOW + 1 }),
    ).rejects.toThrow(/never sent/i);
  });

  test("refuses while protected — an owner must unprotect first", async () => {
    const t = makeT();
    await recallThenDeleteSetup(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
      id: "q1", organizationId: ORG, protect: true, actor, auditId: "a3", now: NOW + 2,
    });

    await expect(del(t, { auditId: "a4", now: NOW + 3 })).rejects.toThrow(/protected/i);
    expect(await getQuotes(t)).toHaveLength(1);

    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteProtectedNative, {
      id: "q1", organizationId: ORG, protect: false, actor, auditId: "a5", now: NOW + 4,
    });
    await del(t, { auditId: "a6", now: NOW + 5 });
    expect(await getQuotes(t)).toHaveLength(0);
  });

  test("an admin — passes isHardLockOverrideAllowed, but is NOT owner-only — is denied", async () => {
    const t = makeT();
    await seedMember(t, "admin");
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: ORG, reason: "Client requested full removal", actor, auditId: "a2", now: NOW + 1,
    });

    await expect(del(t, { auditId: "a3", now: NOW + 2 })).rejects.toThrow(/only an org owner/i);
    expect(await getQuotes(t)).toHaveLength(1);
  });

  test("rolls back to the highest-ever-sent OTHER revision, not necessarily 1", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t); // v1 sent
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    await send(t, { id: "ignored", auditId: "a3", now: NOW + 2 }); // v2 sent, supersedes v1
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q2", organizationId: ORG, reason: "Client requested full removal", actor, auditId: "a4", now: NOW + 3,
    });

    const result = await del(t, { id: "q2", confirmLabel: "RVLT-2026-0087 v2", auditId: "a5", now: NOW + 4 });
    expect(result.revision).toBe(1); // v1 is the highest-ever-sent revision left
    expect((await getProject(t))?.revision).toBe(1);
    expect((await getQuotes(t)).find((q) => q.id === "q1")?.status).toBe("SENT"); // recall already restored it
  });

  test("rejects another org's quote (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.quotesWrites.sendNative, {
      id: "q1", organizationId: OTHER, projectId: "p1", quoteDate: NOW,
      actor: { userId: "user_2", userName: "Bob" }, auditId: "a1", now: NOW,
    });
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: OTHER, reason: "Client requested full removal",
      actor: { userId: "user_2", userName: "Bob" }, auditId: "a2", now: NOW + 1,
    });

    await expect(del(t, { auditId: "a3", now: NOW + 2 })).rejects.toThrow(/quote not found/i);
  });
});

describe("quotesWrites.markAcceptedNative / markDeclinedNative", () => {
  const accept = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.markAcceptedNative, {
      id: "q1", organizationId: ORG, actor, auditId: "a2", now: NOW + 1, ...over,
    } as never);
  const decline = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.markDeclinedNative, {
      id: "q1", organizationId: ORG, reason: "Too expensive", actor, auditId: "a2", now: NOW + 1, ...over,
    } as never);

  test("accept records the date + reference and offers CONFIRMED", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    const result = await accept(t, { acceptanceRef: "PO-4821" });
    expect(result.offerStatusChange).toBe("CONFIRMED");
    const quotes = await getQuotes(t);
    expect(quotes[0]?.status).toBe("ACCEPTED");
    expect(quotes[0]?.acceptanceRef).toBe("PO-4821");
    expect(quotes[0]?.acceptedById).toBe(USER);
  });

  test("an EXPIRED revision cannot be accepted without a re-send", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t, { validityDays: 1 });

    // Two days later the SENT row reads EXPIRED — derived, never stored.
    await expect(accept(t, { now: NOW + 2 * DAY })).rejects.toThrow(/expired/i);
    expect((await getQuotes(t))[0]?.status).toBe("SENT"); // still SENT on disk

    // Re-sending reopens the window, and acceptance then succeeds.
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q1", organizationId: ORG, reason: "Client asked for more time", actor, auditId: "a3", now: NOW + 2 * DAY,
    });
    await send(t, { quoteDate: NOW + 2 * DAY, auditId: "a4", now: NOW + 2 * DAY });
    await accept(t, { auditId: "a5", now: NOW + 2 * DAY + 1 });
    expect((await getQuotes(t))[0]?.status).toBe("ACCEPTED");
  });

  test("decline records a bounded reason and offers CANCELLED without forcing it", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    const result = await decline(t);
    expect(result.offerStatusChange).toBe("CANCELLED");
    expect((await getQuotes(t))[0]?.status).toBe("DECLINED");
    expect((await getProject(t))?.status).toBe("QUOTING"); // NOT forced
    await expect(decline(t, { reason: "x" })).rejects.toThrow(/at least 3/i);
  });

  test("a viewer is denied both verbs", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t);
    await t.run(async (ctx) => {
      const member = await ctx.db.query("members").first();
      await ctx.db.patch(member!._id, { role: "viewer" });
    });

    await expect(accept(t)).rejects.toThrow(/insufficient permissions/i);
    await expect(decline(t)).rejects.toThrow(/insufficient permissions/i);
  });

  test("reject another org's quote (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.quotesWrites.sendNative, {
      id: "q1", organizationId: OTHER, projectId: "p1", quoteDate: NOW,
      actor: { userId: "user_2", userName: "Bob" }, auditId: "a1", now: NOW,
    });

    await expect(accept(t)).rejects.toThrow(/quote not found/i);
    await expect(decline(t)).rejects.toThrow(/quote not found/i);
  });
});

describe("quotes read queries", () => {
  test("listForProject derives EXPIRED and never leaks another org's rows", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t, { validityDays: 1 });
    // A same-projectId row planted under another org — `by_projectId` is global.
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "foreign", organizationId: OTHER, projectId: "p1", version: 9, status: "SENT", snapshot: null,
      });
    });

    const rows = await t
      .withIdentity(asUser(ORG))
      .query(api.quotes.listForProject, { orgId: ORG, projectId: "p1", now: NOW + 2 * DAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.effectiveStatus).toBe("EXPIRED");
    expect(rows[0]?.status).toBe("SENT"); // stored value untouched
  });

  test("revisionStateForProject reports the revision, the draft and the live document", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });

    const state = await t
      .withIdentity(asUser(ORG))
      .query(api.quotes.revisionStateForProject, { orgId: ORG, projectId: "p1", now: NOW + 1 });
    expect(state.revision).toBe(2);
    expect(state.draftQuoteId).toBe("q2");
    expect(state.liveQuote?.id).toBe("q1");
    expect(state.hasAcceptedQuote).toBe(false);
  });
});

describe("quotesWrites.repriceFromRevisionNative — 'use vN's pricing for v(N+1)' (#989 §8.1)", () => {
  const reprice = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.repriceFromRevisionNative, {
      id: "q3", organizationId: ORG, projectId: "p1", sourceQuoteId: "q1", actor, auditId: "a9", now: NOW + 3,
      ...over,
    } as never);

  /** v1 sent at $100/unit, v2 cut then re-priced live to $500 before being sent. */
  async function seedTwoSentRevisions(t: ReturnType<typeof makeT>) {
    await seedMember(t);
    await seedProject(t);
    await send(t); // v1 (q1) — frozen at unitPrice 100
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    await t.run(async (ctx) => {
      const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "l1")).first();
      await ctx.db.patch(line!._id, { unitPrice: 500, lineTotal: 500 });
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { subtotal: 500, total: 550 });
    });
    await send(t, { id: "ignored", auditId: "a3", now: NOW + 2 }); // v2 (q2) — frozen at 500
  }

  test("seeds the next draft with an earlier revision's money fields, structure untouched", async () => {
    const t = makeT();
    await seedTwoSentRevisions(t);

    const result = await reprice(t);
    expect(result).toEqual({ id: "q3", version: 3, sourceVersion: 1 });
    expect((await getProject(t))?.revision).toBe(3);

    const quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "q3")?.status).toBe("DRAFT");
    expect(quotes.find((q) => q.id === "q3")?.snapshot).toBeNull();
    // v1 and v2's own rows are untouched by this — only current live state moved.
    expect(quotes.find((q) => q.id === "q1")?.status).toBe("SUPERSEDED");
    expect(quotes.find((q) => q.id === "q2")?.status).toBe("SENT");

    // The live line item's price reverted to v1's frozen $100 (was $500 from v2's
    // live edit) — but it's still the SAME row (structure untouched). This patches
    // exactly `LOCKED_LINE_ITEM_FIELDS` (unitPrice/discount/discountMode/duration)
    // — the same fields the pre-existing unlock-session FINANCIAL discard restores
    // (`convex/projectUnlockSessionsWrites.ts`); `lineTotal`'s own recompute-on-
    // write is that shared function's concern, not new to this mutation.
    const line = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "l1")).first());
    expect(line?.unitPrice).toBe(100);

    // recalc ran (the project row's updatedAt moved) even though this fixture's
    // stale lineTotal keeps the aggregate subtotal unchanged.
    expect((await getProject(t))?.updatedAt).toBe(NOW + 3);
  });

  test("writes exactly ONE audit entry for the whole operation", async () => {
    const t = makeT();
    await seedTwoSentRevisions(t);
    await reprice(t);

    const entries = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    const repriceEntries = entries.filter((e) => e.entityId === "q3");
    expect(repriceEntries).toHaveLength(1);
    expect(repriceEntries[0]?.summary).toMatch(/using.*v1.*pricing/i);
  });

  test("rejects a source quote that doesn't belong to this project", async () => {
    const t = makeT();
    await seedTwoSentRevisions(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "RVLT-2026-0088", name: "Other gig", isTemplate: false, revision: 1 });
      await ctx.db.insert("quotes", { id: "qOther", organizationId: ORG, projectId: "p2", version: 1, status: "SENT", snapshot: null, snapshotId: "snap_other" });
    });

    await expect(reprice(t, { sourceQuoteId: "qOther" })).rejects.toThrow(/doesn't belong to this project/i);
  });

  test("rejects a source quote with no stored snapshot (never sent)", async () => {
    const t = makeT();
    await seedTwoSentRevisions(t);
    // q2 is SENT (has a snapshotId); a never-sent draft has none — insert one directly.
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", { id: "qDraftOnly", organizationId: ORG, projectId: "p1", version: 99, status: "DRAFT", snapshot: null });
    });

    await expect(reprice(t, { sourceQuoteId: "qDraftOnly" })).rejects.toThrow(/no stored pricing snapshot/i);
  });

  test("rejects when the current revision is still an open draft — edit that instead", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t); // v1 sent
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    }); // v2 draft, still open

    await expect(reprice(t)).rejects.toThrow(/hasn't been sent yet/i);
  });

  test("a viewer is denied", async () => {
    const t = makeT();
    await seedTwoSentRevisions(t);
    await t.run(async (ctx) => {
      const member = await ctx.db.query("members").first();
      await ctx.db.patch(member!._id, { role: "viewer" });
    });

    await expect(reprice(t)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.quotesWrites.sendNative, {
      id: "qF1", organizationId: OTHER, projectId: "p1", quoteDate: NOW, actor: { userId: "user_2", userName: "Bob" }, auditId: "aF1", now: NOW,
    });

    await expect(reprice(t, { sourceQuoteId: "qF1" })).rejects.toThrow(/not found in your organization/i);
  });
});
