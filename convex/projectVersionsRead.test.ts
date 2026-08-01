// @vitest-environment node
//
// convex/projectVersionsRead.ts — Phase 3 (#1080/#1093). Covers the version
// switcher's list read (`listVersions`) plus, since neither had a dedicated
// test file yet, the two existing entry reads it's built on top of
// (`projectLocksRead.snapshotEntries`/`currentEntries`) — the highest-risk new
// read surface in this program per the design doc, because it returns a
// whole project's entity set by snapshot id (R-8.4.3). Also the projection
// PARITY test: the same pure mapper (`@/lib/project-version-projection`)
// applied to a snapshot's entries and to `currentEntries` for the identical
// live fixture must produce equal DTOs — the property that stops the two
// read paths drifting (design doc §8).
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { projectSnapshotEntries } from "@/lib/project-version-projection";

const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = (orgId: string) => ({ subject: USER, orgId });

const modules = import.meta.glob("./**/*.ts");

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

async function seedProject(t: ReturnType<typeof makeT>, orgId = ORG, over: Partial<Doc<"projects">> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, revision: 1,
      subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
      ...over,
    });
    await ctx.db.insert("projectCategories", { id: "cat1", organizationId: orgId, projectId: "p1", name: "Lighting", sortOrder: 0 });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 100, lineTotal: 100,
      categoryId: "cat1", sortOrder: 0,
    });
  });
}

const saveVersion = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.projectVersionsWrites.saveVersionNative, {
    id: "qSave", organizationId: ORG, projectId: "p1", actor, auditId: "aSave", now: NOW, ...over,
  } as never);

const send = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.sendNative, {
    id: "q1", organizationId: ORG, projectId: "p1", quoteDate: NOW, actor, auditId: "a1", now: NOW, ...over,
  } as never);

describe("projectVersionsRead.listVersions", () => {
  test("lists a project's versions with state/date/total, live revision resolved from the project row", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t); // v1 SENT (real quote row)
    await saveVersion(t, { now: NOW + 1 }); // v1 -> re-captured snapshot (VERSION_SAVED), v2 live draft

    const versions = await t
      .withIdentity(asUser(ORG))
      .query(api.projectVersionsRead.listVersions, { projectId: "p1", orgId: ORG, now: NOW });

    expect(versions).toHaveLength(2);
    const v1 = versions.find((v) => v.revision === 1)!;
    const v2 = versions.find((v) => v.revision === 2)!;
    expect(v1.isLive).toBe(false);
    expect(v1.hasSnapshot).toBe(true);
    expect(v1.snapshotReason).toBe("VERSION_SAVED");
    expect(v1.total).toBe(110); // read off the snapshot's frozen project entry
    expect(v2.isLive).toBe(true);
    expect(v2.total).toBe(110); // read straight off the live project row
  });

  test("a project with no quotes yet returns an empty list, not an error", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const versions = await t
      .withIdentity(asUser(ORG))
      .query(api.projectVersionsRead.listVersions, { projectId: "p1", orgId: ORG, now: NOW });
    expect(versions).toEqual([]);
  });

  test("IDOR: a cross-org projectId returns an empty list rather than another org's versions", async () => {
    const t = makeT();
    await seedMember(t);
    await seedMember(t, "owner", OTHER);
    await seedProject(t, OTHER);
    await t.withIdentity(asUser(OTHER)).mutation(api.projectVersionsWrites.saveVersionNative, {
      id: "qOther", organizationId: OTHER, projectId: "p1", actor, auditId: "aOther", now: NOW,
    } as never);

    const versions = await t
      .withIdentity(asUser(ORG))
      .query(api.projectVersionsRead.listVersions, { projectId: "p1", orgId: ORG, now: NOW });
    expect(versions).toEqual([]);
  });

  test("a viewer with no project:read permission in this org is rejected", async () => {
    const t = makeT();
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).query(api.projectVersionsRead.listVersions, { projectId: "p1", orgId: ORG, now: NOW }),
    ).rejects.toThrow();
  });
});

describe("projectLocksRead.snapshotEntries / currentEntries — IDOR (highest-risk new read surface)", () => {
  test("snapshotEntries: a snapshot belonging to another org returns no rows even with a guessed snapshotId", async () => {
    const t = makeT();
    await seedMember(t, "owner", ORG);
    await seedMember(t, "owner", OTHER, "user_2");
    await seedProject(t, OTHER);
    await t.withIdentity({ subject: "user_2", orgId: OTHER }).mutation(api.projectVersionsWrites.saveVersionNative, {
      id: "qOther", organizationId: OTHER, projectId: "p1", actor: { userId: "user_2", userName: "Bob" }, auditId: "aOther", now: NOW,
    } as never);
    const otherSnapshot = await t.run(async (ctx) =>
      ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).first(),
    );
    expect(otherSnapshot).not.toBeNull();

    const entries = await t
      .withIdentity(asUser(ORG))
      .query(api.projectLocksRead.snapshotEntries, { snapshotId: otherSnapshot!.id, orgId: ORG });
    expect(entries).toEqual([]);
  });

  test("currentEntries: a cross-org projectId returns no rows", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER);
    const entries = await t
      .withIdentity(asUser(ORG))
      .query(api.projectLocksRead.currentEntries, { projectId: "p1", orgId: ORG });
    expect(entries).toEqual([]);
  });
});

describe("projection parity (design doc §8) — snapshot-projected DTOs equal live-projected DTOs for the same fixture", () => {
  test("saving a version freezes a snapshot byte-identical (post-mapping) to the live state at that moment", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    // currentEntries BEFORE the save — the live fixture the snapshot freezes.
    const live = await t
      .withIdentity(asUser(ORG))
      .query(api.projectLocksRead.currentEntries, { projectId: "p1", orgId: ORG });

    await saveVersion(t); // captures v1's snapshot from that exact live state

    const v1Snapshot = await t.run(async (ctx) =>
      ctx.db
        .query("projectSnapshots")
        .withIndex("by_projectId", (q) => q.eq("projectId", "p1"))
        .filter((q) => q.eq(q.field("reason"), "VERSION_SAVED"))
        .first(),
    );
    expect(v1Snapshot?.revision).toBe(1);
    const snapshotEntries = await t
      .withIdentity(asUser(ORG))
      .query(api.projectLocksRead.snapshotEntries, { snapshotId: v1Snapshot!.id, orgId: ORG });

    expect(projectSnapshotEntries(snapshotEntries)).toEqual(projectSnapshotEntries(live));
  });
});
