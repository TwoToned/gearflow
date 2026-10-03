// @vitest-environment node
//
// convex/collaboration.ts — the browser-direct comment/review-marker writes.
// Verifies: actor pinned to the verified token (spoofed createdBy ignored), avatar
// colour recomputed from the pinned actor, RBAC on the blocking/resolve/reopen paths
// (viewer denied, member allowed), per-row org re-check, the blocking gate is fed by
// createThread(isBlocking)/setThreadBlocking/resolveThread, and the SERVICE token path
// (deployed image) still works with the pre-migration arg shape (backward-compat).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildBlockingSummary } from "./lib/blockingCommentsGate";
import { getUserColor } from "./lib/collaborationColors";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";
const MEMBER = "user_member";
const VIEWER = "user_viewer";
const PROJECT = "proj_1";

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { id: MEMBER, name: "Mia Member", email: "mia@x.co" });
    await ctx.db.insert("users", { id: VIEWER, name: "Vic Viewer", email: "vic@x.co" });
    await ctx.db.insert("members", { id: "m_member", organizationId: ORG, userId: MEMBER, role: "member" });
    await ctx.db.insert("members", { id: "m_viewer", organizationId: ORG, userId: VIEWER, role: "viewer" });
  });
}

const asMember = { subject: MEMBER, orgId: ORG, role: "member" };
const asViewer = { subject: VIEWER, orgId: ORG, role: "viewer" };
const SERVICE = { subject: "gearflow-service", svc: true };

describe("collaboration browser-direct writes", () => {
  test("createThread (non-blocking) pins the actor + recomputes colour; a spoofed createdBy is ignored", async () => {
    const t = makeT();
    await seed(t);
    const threadId = await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG,
      entityType: "project",
      entityId: PROJECT,
      firstComment: "hello",
      createdBy: "SPOOFED_someone_else", // must be ignored — pinned to the token subject
      createdByName: "Spoofed Name",
    });
    const thread = await t.run(async (ctx) => ctx.db.get(threadId as unknown as Id<"commentThreads">));
    expect(thread!.createdBy).toBe(MEMBER);
    expect(thread!.createdByName).toBe("Mia Member"); // from the users mirror, not the client label
    const comment = await t.run(async (ctx) =>
      ctx.db.query("comments").withIndex("by_orgId_threadId", (q) => q.eq("orgId", ORG).eq("threadId", threadId as string)).first(),
    );
    expect(comment!.authorId).toBe(MEMBER);
    expect(comment!.authorColor).toBe(getUserColor(MEMBER)); // recomputed from the pinned id
  });

  test("blocking createThread requires manage_line_items and feeds the gate; viewer denied; non-project rejected", async () => {
    const t = makeT();
    await seed(t);
    // Viewer lacks manage_line_items → denied.
    await expect(
      t.withIdentity(asViewer).mutation(api.collaboration.createThread, {
        orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "block", createdBy: VIEWER, createdByName: "V", isBlocking: true,
      }),
    ).rejects.toThrow();
    // Blocking on a non-project entity is rejected.
    await expect(
      t.withIdentity(asMember).mutation(api.collaboration.createThread, {
        orgId: ORG, entityType: "asset", entityId: "a1", firstComment: "block", createdBy: MEMBER, createdByName: "M", isBlocking: true,
      }),
    ).rejects.toThrow();
    // Member CAN create a blocking project thread → gate reflects it.
    await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "block", createdBy: MEMBER, createdByName: "M", isBlocking: true,
    });
    const summary = await t.run(async (ctx) => buildBlockingSummary(ctx, ORG, PROJECT));
    expect(summary.hasProjectLevel).toBe(true);
  });

  test("resolveThread clears the gate and is manage_line_items-gated", async () => {
    const t = makeT();
    await seed(t);
    const threadId = await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "block", createdBy: MEMBER, createdByName: "M", isBlocking: true,
    });
    expect((await t.run(async (ctx) => buildBlockingSummary(ctx, ORG, PROJECT))).hasProjectLevel).toBe(true);
    // Viewer cannot resolve.
    await expect(
      t.withIdentity(asViewer).mutation(api.collaboration.resolveThread, { orgId: ORG, threadId: threadId as string, resolvedBy: VIEWER }),
    ).rejects.toThrow();
    // Member resolves → gate clears (status !== open).
    await t.withIdentity(asMember).mutation(api.collaboration.resolveThread, { orgId: ORG, threadId: threadId as string, resolvedBy: MEMBER });
    expect((await t.run(async (ctx) => buildBlockingSummary(ctx, ORG, PROJECT))).hasProjectLevel).toBe(false);
  });

  test("addComment rejects replies on resolved threads and re-checks the thread org", async () => {
    const t = makeT();
    await seed(t);
    const threadId = await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "hi", createdBy: MEMBER, createdByName: "M",
    });
    // Per-row org re-check: a thread owned by ANOTHER org, addressed with the caller's
    // OWN (matching) org, must not be writable → thread.orgId !== args.orgId → not found.
    const foreignThread = await t.run(async (ctx) =>
      ctx.db.insert("commentThreads", {
        orgId: OTHER_ORG, entityType: "project", entityId: "pX", status: "open", isBlocking: false,
        createdBy: "x", createdByName: "x", createdAt: 1, updatedAt: 1,
      }),
    );
    await expect(
      t.withIdentity(asMember).mutation(api.collaboration.addComment, { orgId: ORG, threadId: foreignThread as string, body: "x", authorId: MEMBER, authorName: "M" }),
    ).rejects.toThrow();
    // Normal reply works.
    await t.withIdentity(asMember).mutation(api.collaboration.addComment, { orgId: ORG, threadId: threadId as string, body: "reply", authorId: MEMBER, authorName: "M" });
    // Resolve then reply → rejected.
    await t.withIdentity(asMember).mutation(api.collaboration.resolveThread, { orgId: ORG, threadId: threadId as string, resolvedBy: MEMBER });
    await expect(
      t.withIdentity(asMember).mutation(api.collaboration.addComment, { orgId: ORG, threadId: threadId as string, body: "late", authorId: MEMBER, authorName: "M" }),
    ).rejects.toThrow();
  });

  test("setReviewMarker is any-member (viewer allowed) + pins the actor", async () => {
    const t = makeT();
    await seed(t);
    const id = await t.withIdentity(asViewer).mutation(api.collaboration.setReviewMarker, {
      orgId: ORG, entityType: "project", entityId: PROJECT, targetType: "lineItem", targetId: "li1", status: "needs_review", createdBy: "SPOOF", createdByName: "S",
    });
    const marker = await t.run(async (ctx) => ctx.db.get(id as unknown as Id<"reviewMarkers">));
    expect(marker!.createdBy).toBe(VIEWER); // pinned, spoof ignored
  });

  test("SERVICE token still works with the pre-migration arg shape (backward-compat)", async () => {
    const t = makeT();
    await seed(t);
    // Deployed image sends actor fields + a colour string; service trusts the supplied actor.
    const threadId = await t.withIdentity(SERVICE).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "svc", createdBy: MEMBER, createdByName: "Mia Member", authorColor: "#123456", isBlocking: false,
    });
    const thread = await t.run(async (ctx) => ctx.db.get(threadId as unknown as Id<"commentThreads">));
    expect(thread!.createdBy).toBe(MEMBER);
    // service resolveActor trusts supplied; colour is still recomputed from that id (deterministic parity).
    const comment = await t.run(async (ctx) =>
      ctx.db.query("comments").withIndex("by_orgId_threadId", (q) => q.eq("orgId", ORG).eq("threadId", threadId as string)).first(),
    );
    expect(comment!.authorColor).toBe(getUserColor(MEMBER));
  });
});

describe("mentions → notifications (work-layer phase 0, #1241)", () => {
  test("createThread with mentions writes exactly one notification for the mentioned user, never the author", async () => {
    const t = makeT();
    await seed(t);
    await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "hey @Vic check this out",
      createdBy: MEMBER, createdByName: "M", mentionUserIds: [VIEWER, MEMBER],
    });
    const rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(VIEWER);
    expect(rows[0].type).toBe("mentioned");
    expect(rows[0].organizationId).toBe(ORG);
  });

  test("addComment only notifies users newly mentioned in THAT reply, not the thread's merged history", async () => {
    const t = makeT();
    await seed(t);
    const threadId = await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "start", createdBy: MEMBER, createdByName: "M",
      mentionUserIds: [VIEWER],
    });
    expect((await t.run(async (ctx) => ctx.db.query("notifications").collect())).length).toBe(1);
    // Reply mentions VIEWER again — a second, distinct comment, so it earns its own
    // notification; it must not re-scan the thread's cumulative mentionUserIds.
    await t.withIdentity(asMember).mutation(api.collaboration.addComment, {
      orgId: ORG, threadId: threadId as string, body: "reply @Vic", authorId: MEMBER, authorName: "M", mentionUserIds: [VIEWER],
    });
    const rows = await t.run(async (ctx) => ctx.db.query("notifications").collect());
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.userId === VIEWER)).toBe(true);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(2); // distinct comments → distinct dedupe keys
  });

  test("a rejected comment write leaves no notification behind — commit or nothing, atomically", async () => {
    const t = makeT();
    await seed(t);
    const threadId = await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "start", createdBy: MEMBER, createdByName: "M",
    });
    await t.withIdentity(asMember).mutation(api.collaboration.resolveThread, { orgId: ORG, threadId: threadId as string, resolvedBy: MEMBER });
    // A reply mentioning VIEWER on a RESOLVED thread is rejected before any write happens.
    await expect(
      t.withIdentity(asMember).mutation(api.collaboration.addComment, {
        orgId: ORG, threadId: threadId as string, body: "late @Vic", authorId: MEMBER, authorName: "M", mentionUserIds: [VIEWER],
      }),
    ).rejects.toThrow();
    expect(await t.run(async (ctx) => ctx.db.query("notifications").collect())).toEqual([]);
  });
});

// #1245 (Phase 3) — activityEvents' denormalised clientId/contactId, the
// index key the client timeline read model relies on.
describe("recordActivity stamps clientId/contactId (#1245)", () => {
  test("a comment on a client entity stamps clientId = the entity itself", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => ctx.db.insert("clients", { id: "cl1", organizationId: ORG, name: "Acme" }));
    await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "client", entityId: "cl1", firstComment: "hello", createdBy: MEMBER, createdByName: "M",
    });
    const events = await t.run((ctx) =>
      ctx.db.query("activityEvents").withIndex("by_orgId_clientId_createdAt", (q) => q.eq("orgId", ORG).eq("clientId", "cl1")).collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0].entityType).toBe("client");
  });

  test("a comment on a project resolves clientId from the project's own clientId field", async () => {
    const t = makeT();
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("clients", { id: "cl1", organizationId: ORG, name: "Acme" });
      await ctx.db.insert("projects", { id: PROJECT, organizationId: ORG, projectNumber: "P1", name: "Gala", clientId: "cl1", isTemplate: false });
    });
    await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "hello", createdBy: MEMBER, createdByName: "M",
    });
    const events = await t.run((ctx) =>
      ctx.db.query("activityEvents").withIndex("by_orgId_clientId_createdAt", (q) => q.eq("orgId", ORG).eq("clientId", "cl1")).collect(),
    );
    expect(events).toHaveLength(1);
  });

  test("a project with no client leaves clientId unset (not a write failure)", async () => {
    const t = makeT();
    await seed(t);
    await t.run((ctx) => ctx.db.insert("projects", { id: PROJECT, organizationId: ORG, projectNumber: "P1", name: "Gala", isTemplate: false }));
    const threadId = await t.withIdentity(asMember).mutation(api.collaboration.createThread, {
      orgId: ORG, entityType: "project", entityId: PROJECT, firstComment: "hello", createdBy: MEMBER, createdByName: "M",
    });
    expect(threadId).toBeTruthy();
    const events = await t.run((ctx) =>
      ctx.db.query("activityEvents").withIndex("by_orgId_entityId_createdAt", (q) => q.eq("orgId", ORG).eq("entityId", PROJECT)).collect(),
    );
    expect(events[0].clientId).toBeUndefined();
  });
});
