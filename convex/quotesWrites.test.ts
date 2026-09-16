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
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
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
  // #1236 — accepting a quote moves the project into AWAITING_PAYMENT, now an
  // ACTIVE project status, so the dashboard counter is bumped here.
  registerShardedCounter(t, "shardedCounter");
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
      liveVersionId: "v-p1",
    });
    await ctx.db.insert("projectVersions", { id: "v-p1", organizationId: orgId, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 100, lineTotal: 100,
      versionId: "v-p1",
      lineageId: "l1",
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

  // #1160 — sending now MOVES the job to QUOTED itself (the org can opt out), so
  // the offer is the opt-out path rather than the normal one. The other quote verbs
  // are unchanged: accept/decline still only offer.
  test("advances QUOTING → QUOTED itself, and reports it instead of offering", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, "QUOTING");

    const result = await send(t);
    expect(result.autoStatusChange).toBe("QUOTED");
    expect(result.offerStatusChange).toBeNull(); // nothing left to ask
    expect((await getProject(t))?.status).toBe("QUOTED");
  });

  test("with the org opted out, it falls back to the passive offer and forces nothing", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, "QUOTING");
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", {
        organizationId: ORG,
        settings: JSON.stringify({ projectStatusAutomation: { quoteSent: false } }),
      });
    });

    const result = await send(t);
    expect(result.autoStatusChange).toBeNull();
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

  // #1230: `prepareSend`'s own `assertLifecycleGuard` call (which used to
  // reject sending on an already-FINANCE_LOCKED/CONFIRMED+ project) is
  // deleted — sendNative doesn't touch any of `LOCKED_*_FIELDS`, so there's
  // nothing for the pricing lock to gate here. Sending IS the freeze moment
  // (D55): it always succeeds and raises `pricingLocked`, idempotently, even
  // on a project that's already locked (e.g. re-sending a CONFIRMED job).
  test("sending on an already-CONFIRMED (pricing-locked) project succeeds — D55 is idempotent, not a gate", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProject(t, ORG, "CONFIRMED");
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { pricingLocked: true, pricingLockedAt: NOW - 1000, pricingLockedById: "someone_else" });
    });
    await send(t);
    const p = await getProject(t);
    expect(p?.pricingLocked).toBe(true);
    expect(p?.pricingLockedAt).toBe(NOW - 1000); // untouched — already locked, D55 is a no-op
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

  test("sends the LIVE revision, not the allocator's high-water mark, when a promote left them apart (#1080/#1097)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    // Simulate the state right after a promote landed an older, never-sent
    // PRE_PROMOTE draft as live: revision (allocator) stays ahead of
    // liveRevision, and the live row is a DRAFT with no sentAt.
    await t.run(async (ctx) => {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { revision: 3, liveRevision: 1 });
    });

    const result = await send(t);
    // Sends v1 (the LIVE revision) — not v3, and not a QUOTE_ALREADY_SENT/
    // QUOTE_VERSION_CONFLICT throw from misreading the allocator.
    expect(result.version).toBe(1);
    const quotes = await getQuotes(t);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.version).toBe(1);
    expect(quotes[0]?.status).toBe("SENT");
  });

  // #1229 Phase 3 deleted `saveVersionNative` (superseded by `versions.
  // createNative` on the real `projectVersions` table) — these two tests
  // used it purely as a convenient way to move `liveRevision` to v2 (with or
  // without a label already on the row); seeded directly instead.
  test("labelOnDocument is stamped only when requested AND the revision already carries a label", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { revision: 2, liveRevision: 2 });
    });
    // Requested but no label on the row — nothing to print, so nothing is stamped.
    const noLabel = await send(t, { id: "q1", labelOnDocument: true });
    expect(noLabel.version).toBe(2); // liveRevision was already 2
    expect((await getQuotes(t)).find((q) => q.version === 2)?.labelOnDocument).toBeUndefined();
  });

  test("labelOnDocument stamps true when the labelled revision opts in at send", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { revision: 2, liveRevision: 2 });
      await ctx.db.insert("quotes", {
        id: "vDraft", organizationId: ORG, projectId: "p1", version: 2, status: "DRAFT",
        snapshot: null, label: "Budget option", createdAt: NOW - 1, updatedAt: NOW - 1,
      });
    });

    const result = await send(t, { id: "q2", labelOnDocument: true });
    expect((await getQuotes(t)).find((q) => q.id === result.id)?.labelOnDocument).toBe(true);
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

describe("quotesWrites.setQuoteLabelNative — rename a version from the row (#1080/#1097)", () => {
  const setLabel = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.setQuoteLabelNative, {
      id: "q1", organizationId: ORG, actor, auditId: "a2", now: NOW + 1, ...over,
    } as never);

  test("sets and clears a label, bounded to 60 chars", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    const result = await setLabel(t, { label: "Budget option" });
    expect(result.label).toBe("Budget option");
    expect((await getQuotes(t))[0]?.label).toBe("Budget option");

    const cleared = await setLabel(t, { label: "", auditId: "a3", now: NOW + 2 });
    expect(cleared.label).toBeNull();

    await expect(setLabel(t, { label: "x".repeat(61), auditId: "a4" })).rejects.toThrow();
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

    await expect(setLabel(t, { label: "x" })).rejects.toThrow(/insufficient permissions/i);
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

  // #1229 Phase 3 — recall no longer un-supersedes the revision it displaced
  // (the branch assumed send-supersedes-across-REVISIONS, which stops being
  // the model once versioning moves onto the real `projectVersions` table).
  test("no longer restores the revision this send superseded (#1229 Phase 3)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });
    await send(t, { id: "ignored", auditId: "a3", now: NOW + 2 });

    const result = await recall(t, { id: "q2", auditId: "a4", now: NOW + 3 });
    expect(result.restoredQuoteId).toBeNull();

    const quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "q1")?.status).toBe("SUPERSEDED");
    expect(quotes.find((q) => q.id === "q2")?.status).toBe("DRAFT");
  });

  // #1230 (D42): canUnlockPricing = hasPermission(role, "invoice", "publish")
  // || isProjectManagerOf — every verb's own base gate (`guardQuoteWrite`)
  // already requires invoice:publish, so a manager (who has it) now passes
  // recall's layered check directly, with no PM assignment needed — widened
  // from the old admin/owner-only `isHardLockOverrideAllowed` role test.
  // (The PM disjunct still matters for OTHER canUnlockPricing call sites
  // whose base gate is the broader `project:update`, e.g.
  // `projectWrites.updateStatusNative` — see projectWrites.test.ts.)
  test("a manager can send AND recall directly — invoice:publish is canUnlockPricing's audience (D42)", async () => {
    const t = makeT();
    await seedMember(t, "manager");
    await seedProject(t);
    await send(t); // manager sends fine — invoice:publish

    await recall(t);
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

  // #1230: the protect/unprotect mechanism (#1030's auto-protect-on-accept,
  // and the check against it here) is deleted entirely along with the rest
  // of the 4-tier lock system — a legacy `protected:true` row (pre-#1230,
  // the field stays on the schema DEPRECATED for back-compat) no longer
  // blocks a recall.
  test("a legacy protected:true row no longer blocks recall (#1230 — protect/unprotect deleted)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      await ctx.db.patch(quote!._id, { protected: true, protectedAt: NOW + 1, protectedById: USER });
    });

    await recall(t, { auditId: "a3", now: NOW + 2 });
    expect((await getQuotes(t))[0]?.status).toBe("DRAFT");
  });

  // D55/D56 (#1230): sendNative raises projects.pricingLocked when it sends
  // the LIVE version's quote; recallNative clears it again for that same
  // live-version quote. A status revert never touches the flag (see
  // projectWrites.test.ts — only a person lowers it, via unlockPricingNative).
  test("D55/D56: send locks pricing, recall of the LIVE quote clears it again", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    expect((await getProject(t))?.pricingLocked).toBe(true);

    await recall(t);
    expect((await getProject(t))?.pricingLocked).toBe(false);
  });

  test("D56: recalling a SENT quote whose version is no longer LIVE does NOT clear the lock (#1233)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t); // v1 sent while its version ("v-p1") is live — locks pricing, stamps versionId: "v-p1"
    expect((await getProject(t))?.pricingLocked).toBe(true);
    expect((await getQuotes(t)).find((q) => q.id === "q1")?.versionId).toBe("v-p1");

    // A REAL make-live to a second version — the reachable #1233 way
    // `liveVersionId` moves. v1's quote row is untouched, still SENT, but
    // its `versionId` ("v-p1") is no longer the project's live version.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: "v-p1-b", organizationId: ORG, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1" });
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { liveVersionId: "v-p1-b" });
    });

    // v1 is still SENT (never superseded), so recallNative's status check
    // still lets it through — but D56 must not clear the lock: "v-p1-b", not
    // "v-p1", is the live version now.
    await recall(t, { auditId: "a3", now: NOW + 2 });
    expect((await getQuotes(t)).find((q) => q.id === "q1")?.status).toBe("DRAFT");
    expect((await getProject(t))?.pricingLocked).toBe(true);
  });

  // Pre-#1233 rows (no `versionId` stamped) fall back to the OLDER
  // revision-number check — the same scenario the deleted `promoteRevisionNative`
  // used to be able to produce, preserved here as a back-compat proof that a
  // legacy row without `versionId` still behaves exactly as it did before
  // Phase 6 (`quoteTargetsLiveVersion`'s fallback branch, `quoteState.ts`).
  test("D56 back-compat: a pre-#1233 row (no versionId) falls back to the revision-number check", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    expect((await getProject(t))?.pricingLocked).toBe(true);

    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      await ctx.db.patch(quote!._id, { versionId: undefined });
      const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(project!._id, { revision: 2, liveRevision: 2 });
    });

    await recall(t, { auditId: "a3", now: NOW + 2 });
    expect((await getQuotes(t)).find((q) => q.id === "q1")?.status).toBe("DRAFT");
    expect((await getProject(t))?.pricingLocked).toBe(true);
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

  // #1230: the whole protect/unprotect mechanism (setQuoteProtectedNative was
  // already gone since #1229 Phase 3) is deleted — `assertRecalledDeletable`
  // no longer checks `protected` at all. `protected`/`protectedAt`/
  // `protectedById` stay on the schema (DEPRECATED, optional) only so a
  // pre-#1230 row that still carries `true` doesn't fail the schema push —
  // this proves a legacy `protected:true` row no longer blocks the delete.
  test("a legacy protected:true row no longer blocks deletion (#1230 — protect/unprotect deleted)", async () => {
    const t = makeT();
    await recallThenDeleteSetup(t);
    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q1")).first();
      await ctx.db.patch(quote!._id, { protected: true, protectedAt: NOW + 2, protectedById: USER });
    });

    await del(t, { auditId: "a4", now: NOW + 3 });
    expect(await getQuotes(t)).toHaveLength(0);
  });

  test("an admin — passes canUnlockPricing, but is NOT owner-only — is denied", async () => {
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
    // #1229 Phase 3 — recall no longer un-supersedes the revision it displaced,
    // so v1 stays SUPERSEDED (rollback is keyed on sentAt, not current status).
    expect((await getQuotes(t)).find((q) => q.id === "q1")?.status).toBe("SUPERSEDED");
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

  // #1236 — accepting advances the job to AWAITING_PAYMENT (agreed, unpaid),
  // NOT to CONFIRMED. Confirming is what payment does. The pre-#1236
  // `offerStatusChange: "CONFIRMED"` survives only for an org that opted out.
  test("accept records the date + reference and advances to AWAITING_PAYMENT", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    const result = await accept(t, { acceptanceRef: "PO-4821" });
    expect(result.autoStatusChange).toBe("AWAITING_PAYMENT");
    expect(result.offerStatusChange).toBeNull();
    expect((await getProject(t))?.status).toBe("AWAITING_PAYMENT");
    const quotes = await getQuotes(t);
    expect(quotes[0]?.status).toBe("ACCEPTED");
    expect(quotes[0]?.acceptanceRef).toBe("PO-4821");
    expect(quotes[0]?.acceptedById).toBe(USER);
  });

  // #1230: `markAcceptedNative`'s #1030 auto-protect side effect is deleted
  // along with the whole protect/unprotect mechanism — accepting no longer
  // stamps `protected` at all (the field stays on the schema, DEPRECATED,
  // only for pre-#1230 rows that already carry it).
  test("accepting a quote does not set the (deprecated) protected flag", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t);
    await send(t);

    await accept(t);

    const [quote] = await getQuotes(t);
    expect(quote?.status).toBe("ACCEPTED");
    expect(quote?.protected).toBeFalsy();
  });

  test("with the org opted out, accept falls back to offering CONFIRMED", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgSettings", {
        organizationId: ORG,
        settings: JSON.stringify({ projectStatusAutomation: { quoteSent: false, quoteAccepted: false } }),
      });
    });
    await send(t);

    const result = await accept(t);
    expect(result.autoStatusChange).toBeNull();
    expect(result.offerStatusChange).toBe("CONFIRMED");
    expect((await getProject(t))?.status).toBe("QUOTING"); // NOT forced
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
    // The send above auto-advanced QUOTING → QUOTED (#1160); declining must not
    // move it again — CANCELLED stays an offer, never applied.
    expect((await getProject(t))?.status).toBe("QUOTED");
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

// #1233 (Phase 6, parent #1221) — "quotes from any version". `seedProject`
// seeds ONE version ("v-p1", live). These tests add a SECOND, non-live
// version ("v-p1-b") with its own line item, so `sendNative({versionId})`
// has real, distinguishable content to freeze from either target.
describe("quotesWrites — #1233 Phase 6 (quotes from any version)", () => {
  async function seedSecondVersion(t: ReturnType<typeof makeT>, orgId = ORG) {
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", {
        id: "v-p1-b", organizationId: orgId, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1",
      });
      await ctx.db.insert("projectLineItems", {
        id: "l2", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "Budget PA", quantity: 1, unitPrice: 50, lineTotal: 50,
        versionId: "v-p1-b", lineageId: "l2",
      });
    });
  }

  const sendVersion = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
    t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.sendNative, sendArgs(over) as never);

  test("D19: two versions of one project hold SENT quotes simultaneously — neither supersedes the other", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await seedSecondVersion(t);

    // Version A ("v-p1", live) — quote q1.
    const resultA = await sendVersion(t, { id: "q1", versionId: "v-p1", auditId: "a1" });
    expect(resultA.version).toBe(1);
    // Version B ("v-p1-b", non-live) — quote q2, a DIFFERENT row.
    const resultB = await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a2", now: NOW + 1 });
    expect(resultB.version).toBe(2); // a fresh number off the same allocator

    const quotes = await getQuotes(t);
    const qA = quotes.find((q) => q.id === "q1");
    const qB = quotes.find((q) => q.id === "q2");
    expect(qA?.status).toBe("SENT");
    expect(qB?.status).toBe("SENT"); // NOT superseded by qA
    expect(qA?.versionId).toBe("v-p1");
    expect(qB?.versionId).toBe("v-p1-b");

    // Each froze ITS OWN version's line items, not the other's.
    const snapA = qA?.snapshot as { lines: { description: string }[]; total: number };
    const snapB = qB?.snapshot as { lines: { description: string }[]; total: number };
    expect(snapA.lines.some((l) => l.description === "PA System")).toBe(true);
    expect(snapA.lines.some((l) => l.description === "Budget PA")).toBe(false);
    expect(snapB.lines.some((l) => l.description === "Budget PA")).toBe(true);
    expect(snapB.lines.some((l) => l.description === "PA System")).toBe(false);
    expect(snapB.total).toBe(50);
  });

  test("D55: sending the LIVE version locks pricing; sending a NON-live version does not", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await seedSecondVersion(t);

    await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a1" });
    expect((await getProject(t))?.pricingLocked).toBeFalsy();

    await sendVersion(t, { id: "q1", versionId: "v-p1", auditId: "a2", now: NOW + 1 });
    expect((await getProject(t))?.pricingLocked).toBe(true);
  });

  test("re-sending a version reuses its row: status back to SENT, old PDF pushed onto recalledPdfFileIds, nothing superseded", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await seedSecondVersion(t);

    await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a1" });
    await t.run(async (ctx) => {
      const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", "q2")).first();
      await ctx.db.patch(quote!._id, { pdfFileId: "storage_old_1" });
    });

    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q2", organizationId: ORG, reason: "Fix a typo before resending", actor, auditId: "a2", now: NOW + 1,
    });
    let quotes = await getQuotes(t);
    expect(quotes).toHaveLength(1); // same row, not a new one
    expect(quotes.find((q) => q.id === "q2")?.status).toBe("DRAFT");
    expect(quotes.find((q) => q.id === "q2")?.recalledPdfFileIds).toEqual(["storage_old_1"]);

    await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a3", now: NOW + 2 });
    quotes = await getQuotes(t);
    expect(quotes).toHaveLength(1); // STILL the same row — reused, not a second one
    const reused = quotes.find((q) => q.id === "q2");
    expect(reused?.status).toBe("SENT");
    expect(reused?.pdfFileId).toBeUndefined(); // cleared by recall; forces a fresh render
    expect(reused?.recalledPdfFileIds).toEqual(["storage_old_1"]); // preserved, not erased
  });

  test("sendNative validates versionId against the project — cross-project version is rejected", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "RVLT-2026-0088", name: "Other Gig", status: "QUOTING", isTemplate: false, revision: 1, liveVersionId: "v-p2", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectVersions", { id: "v-p2", organizationId: ORG, projectId: "p2", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
    });

    await expect(sendVersion(t, { id: "q1", versionId: "v-p2" })).rejects.toThrow();
  });

  describe("D20: accept = make live", () => {
    const accept = (t: ReturnType<typeof makeT>, id: string, over: Partial<Record<string, unknown>> = {}) =>
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.markAcceptedNative, {
        id, organizationId: ORG, actor, auditId: "acc1", now: NOW + 2, ...over,
      } as never);

    test("accepting a NON-live version's quote makes that version live", async () => {
      const t = makeT();
      await seedMember(t);
      await seedProject(t);
      await seedSecondVersion(t);
      await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a1" });

      const result = await accept(t, "q2");
      expect(result.madeLive).toBe(true);
      expect((await getQuotes(t)).find((q) => q.id === "q2")?.status).toBe("ACCEPTED");

      const project = await getProject(t);
      expect(project?.liveVersionId).toBe("v-p1-b");
      // The accepted version's own content ("Budget PA") is now what recalc
      // priced onto the live project.
      expect(project?.total).toBe(50);
    });

    test("accepting supersedes every OTHER open quote across every version — at most one ACCEPTED per project", async () => {
      const t = makeT();
      await seedMember(t);
      await seedProject(t);
      await seedSecondVersion(t);
      await sendVersion(t, { id: "q1", versionId: "v-p1", auditId: "a1" });
      await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a2", now: NOW + 1 });

      await accept(t, "q2");

      const quotes = await getQuotes(t);
      expect(quotes.find((q) => q.id === "q2")?.status).toBe("ACCEPTED");
      expect(quotes.find((q) => q.id === "q1")?.status).toBe("SUPERSEDED");
      expect(quotes.find((q) => q.id === "q1")?.supersededByQuoteId).toBe("q2");
    });

    test("accepting the ALREADY-live version's quote does not call make-live but still supersedes other open quotes", async () => {
      const t = makeT();
      await seedMember(t);
      await seedProject(t);
      await seedSecondVersion(t);
      await sendVersion(t, { id: "q1", versionId: "v-p1", auditId: "a1" });
      await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a2", now: NOW + 1 });

      const result = await accept(t, "q1");
      expect(result.madeLive).toBe(false);
      expect((await getProject(t))?.liveVersionId).toBe("v-p1");

      const quotes = await getQuotes(t);
      expect(quotes.find((q) => q.id === "q1")?.status).toBe("ACCEPTED");
      expect(quotes.find((q) => q.id === "q2")?.status).toBe("SUPERSEDED");
    });

    // #1236 — the make-live effect (Phase 6, D20) and the status-automation
    // effect (#1236) are independent code paths composed in the same
    // transaction; this proves they don't clobber each other's return fields.
    test("accepting a NON-live version's quote that also triggers AWAITING_PAYMENT reports both effects, with offerStatusChange null", async () => {
      const t = makeT();
      await seedMember(t);
      await seedProject(t); // status: QUOTING — inside QUOTE_ACCEPTED's `from` set
      await seedSecondVersion(t);
      await sendVersion(t, { id: "q2", versionId: "v-p1-b", auditId: "a1" });

      const result = await accept(t, "q2");
      expect(result.madeLive).toBe(true);
      expect(result.conflicts).toEqual([]);
      expect(result.autoStatusChange).toBe("AWAITING_PAYMENT");
      expect(result.offerStatusChange).toBeNull();

      const project = await getProject(t);
      expect(project?.liveVersionId).toBe("v-p1-b");
      expect(project?.status).toBe("AWAITING_PAYMENT");
    });
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

