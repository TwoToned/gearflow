// @vitest-environment node
//
// convex/backfillProjectPricingLock.ts — #1230 Phase 4 ("Project versioning
// v2", parent #1221). Verifies: a CONFIRMED+ status project gets locked, a
// project whose live revision has a SENT/ACCEPTED/EXPIRED quote gets locked
// even while its own status is still OPEN (QUOTED), an OPEN project with no
// live-holding quote is left untouched, templates are skipped, an
// already-locked project is a no-op (idempotent), dry-run writes nothing,
// and the lock follows liveRevision (not the allocator) the same way
// `sendNative`/`projectLocksRead` already do.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { assertExpectedProjectCount } from "./backfillProjectPricingLock";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const SERVICE = { subject: "gearflow-service", svc: true };
type T = TestConvex<typeof schema>;
const makeT = (): T => convexTest(schema, modules);

function project(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, organizationId: ORG, projectNumber: `P-${id}`, name: "Gig",
    status: "QUOTED" as const, isTemplate: false, revision: 1,
    createdAt: NOW, updatedAt: NOW, ...extra,
  };
}
function quote(id: string, projectId: string, version: number, status: string, extra: Record<string, unknown> = {}) {
  return { id, organizationId: ORG, projectId, version, status, snapshot: null, ...extra };
}

async function seed(t: T, docs: Record<string, unknown>[], table: "projects" | "quotes") {
  await t.run(async (ctx) => {
    for (const doc of docs) await ctx.db.insert(table, doc as never);
  });
}

const run = (t: T, apply: boolean, numItems = 100) =>
  t.withIdentity(SERVICE).mutation(api.backfillProjectPricingLock.backfillProjectPricingLockPage, {
    cursor: null, apply, numItems,
  });

const getProject = (t: T, id: string) =>
  t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).first());

describe("backfillProjectPricingLock", () => {
  test("locks a CONFIRMED+ project with no quote at all", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "CONFIRMED" })], "projects");

    const res = await run(t, true);
    expect(res.scanned).toBe(1);
    expect(res.locked).toBe(1);

    const p = await getProject(t, "p1");
    expect(p?.pricingLocked).toBe(true);
    expect(p?.pricingLockedById).toBe("system");
  });

  test("locks an OPEN-status project whose live revision has a SENT quote", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "QUOTED" })], "projects");
    await seed(t, [quote("q1", "p1", 1, "SENT", { sentAt: NOW })], "quotes");

    const res = await run(t, true);
    expect(res.locked).toBe(1);
    expect((await getProject(t, "p1"))?.pricingLocked).toBe(true);
  });

  test("locks on an ACCEPTED quote too", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "QUOTED" })], "projects");
    await seed(t, [quote("q1", "p1", 1, "ACCEPTED", { sentAt: NOW, acceptedAt: NOW })], "quotes");

    const res = await run(t, true);
    expect(res.locked).toBe(1);
  });

  test("locks on an EXPIRED-derived SENT quote (validUntil already passed)", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "QUOTED" })], "projects");
    await seed(t, [quote("q1", "p1", 1, "SENT", { sentAt: NOW - 30 * DAY, validUntil: NOW - DAY })], "quotes");

    const res = await run(t, true);
    expect(res.locked).toBe(1);
  });

  test("leaves an OPEN project with only a DRAFT quote untouched", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "QUOTED" })], "projects");
    await seed(t, [quote("q1", "p1", 1, "DRAFT")], "quotes");

    const res = await run(t, true);
    expect(res.locked).toBe(0);
    expect((await getProject(t, "p1"))?.pricingLocked).toBeFalsy();
  });

  test("only checks the LIVE revision's quote, not a superseded one (liveRevision, not the allocator)", async () => {
    const t = makeT();
    // revision (allocator) is 2, but liveRevision points back at v1 — a
    // promote scenario. v2's quote is SENT, but v2 isn't live; v1's quote is
    // a DRAFT. The lock must follow liveRevision (stay unlocked), never the
    // allocator's max.
    await seed(t, [project("p1", { status: "QUOTED", revision: 2, liveRevision: 1 })], "projects");
    await seed(t, [
      quote("q1", "p1", 1, "DRAFT"),
      quote("q2", "p1", 2, "SENT", { sentAt: NOW }),
    ], "quotes");

    const res = await run(t, true);
    expect(res.locked).toBe(0);
  });

  test("skips templates entirely", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "CONFIRMED", isTemplate: true })], "projects");

    const res = await run(t, true);
    expect(res.scanned).toBe(0);
    expect(res.locked).toBe(0);
    expect((await getProject(t, "p1"))?.pricingLocked).toBeFalsy();
  });

  test("is idempotent — an already-locked project is skipped on a re-run", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "CONFIRMED", pricingLocked: true, pricingLockedAt: 1, pricingLockedById: "u1" })], "projects");

    const res = await run(t, true);
    expect(res.locked).toBe(0);
    // Untouched — not re-stamped with the backfill's own attribution.
    expect((await getProject(t, "p1"))?.pricingLockedById).toBe("u1");
  });

  test("a dry run (apply:false) counts but writes nothing", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "CONFIRMED" })], "projects");

    const res = await run(t, false);
    expect(res.locked).toBe(1);
    expect((await getProject(t, "p1"))?.pricingLocked).toBeFalsy();
  });

  test("never LOWERS the flag — irrelevant here (backfill only ever raises), but a QUOTED/unlocked project stays unlocked", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "QUOTING" })], "projects");

    const res = await run(t, true);
    expect(res.locked).toBe(0);
    expect((await getProject(t, "p1"))?.pricingLocked).toBeFalsy();
  });

  test("requires a service identity", async () => {
    const t = makeT();
    await seed(t, [project("p1")], "projects");
    await expect(
      t.mutation(api.backfillProjectPricingLock.backfillProjectPricingLockPage, { cursor: null, apply: false }),
    ).rejects.toThrow();
  });
});

describe("backfillProjectPricingLock.verifyProjectPricingLock", () => {
  test("reports zero remaining after a full apply run", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "CONFIRMED" }), project("p2", { status: "QUOTED" })], "projects");
    await run(t, true);

    const result = await t.withIdentity(SERVICE).query(api.backfillProjectPricingLock.verifyProjectPricingLock, {
      cursor: null,
    });
    expect(result.totalProjects).toBe(2);
    expect(result.projectsNeedingLockButUnlocked).toBe(0);
  });

  test("reports a non-zero count before the migration runs", async () => {
    const t = makeT();
    await seed(t, [project("p1", { status: "CONFIRMED" })], "projects");

    const result = await t.withIdentity(SERVICE).query(api.backfillProjectPricingLock.verifyProjectPricingLock, {
      cursor: null,
    });
    expect(result.projectsNeedingLockButUnlocked).toBe(1);
  });
});

describe("assertExpectedProjectCount", () => {
  test("no-ops when expected is undefined", () => {
    expect(() => assertExpectedProjectCount(5, undefined)).not.toThrow();
  });
  test("throws on a mismatch", () => {
    expect(() => assertExpectedProjectCount(5, 6)).toThrow(/Refusing to migrate/);
  });
  test("passes on a match", () => {
    expect(() => assertExpectedProjectCount(5, 5)).not.toThrow();
  });
});
