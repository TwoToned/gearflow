// @vitest-environment node
//
// maybeSeedWorkTemplates (#1243 Phase 1, design doc §8.2). Verifies: only
// CONFIRMED is wired, the org's own workTemplates rows override the defaults,
// isActive:false is excluded, offsets resolve against trigger time vs.
// rentalStart/End, a missing base date skips only that item's dueDate (not the
// row), idempotency by sourceKey, and cross-org isolation.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "../schema";
import { maybeSeedWorkTemplates } from "./workTemplateSeeding";

const modules = import.meta.glob("../**/*.ts");
type T = TestConvex<typeof schema>;

const ORG = "org_1";
const OTHER = "org_2";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const ACTOR = { userId: "u1", userName: "Alice" };

function makeT(): T {
  return convexTest(schema, modules);
}

async function seedProject(t: T, opts: { rentalStartDate?: number; rentalEndDate?: number } = {}) {
  await t.run((ctx) =>
    ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false,
      rentalStartDate: opts.rentalStartDate, rentalEndDate: opts.rentalEndDate, createdAt: NOW, updatedAt: NOW,
    }),
  );
}

const tasksFor = (t: T, projectId: string) =>
  t.run((ctx) => ctx.db.query("projectTasks").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect());

describe("maybeSeedWorkTemplates", () => {
  test("a triggerStatus other than CONFIRMED is a no-op", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "PREPPING", actor: ACTOR, now: NOW }));
    expect(await tasksFor(t, "p1")).toHaveLength(0);
  });

  test("offsetFrom trigger resolves against `now`, unaffected by missing rental dates", async () => {
    const t = makeT();
    await seedProject(t); // no rentalStartDate/EndDate
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    const deposit = tasks.find((x) => x.templateId === "send-deposit-invoice");
    expect(deposit?.dueDate).toBe(NOW + DAY);
    const crew = tasks.find((x) => x.templateId === "book-crew");
    expect(crew?.dueDate).toBe(NOW + 3 * DAY);
  });

  test("offsetFrom rentalStart/rentalEnd items get no dueDate (but ARE still seeded) when the base date is missing", async () => {
    const t = makeT();
    await seedProject(t); // no dates
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    const venue = tasks.find((x) => x.templateId === "confirm-venue-access");
    expect(venue).toBeDefined();
    expect(venue?.dueDate).toBeUndefined();
  });

  test("offsetFrom rentalStart/rentalEnd resolve correctly when the dates ARE set", async () => {
    const t = makeT();
    const rentalStartDate = NOW + 10 * DAY;
    const rentalEndDate = NOW + 12 * DAY;
    await seedProject(t, { rentalStartDate, rentalEndDate });
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    expect(tasks.find((x) => x.templateId === "confirm-venue-access")?.dueDate).toBe(rentalStartDate - 5 * DAY);
    expect(tasks.find((x) => x.templateId === "truck-pack")?.dueDate).toBe(rentalStartDate - 1 * DAY);
    expect(tasks.find((x) => x.templateId === "chase-balance")?.dueDate).toBe(rentalEndDate + 7 * DAY);
  });

  test("idempotent — a second run against the same project seeds nothing new", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const first = await tasksFor(t, "p1");
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW + DAY }));
    const second = await tasksFor(t, "p1");
    expect(second).toHaveLength(first.length);
  });

  test("PM resolution: projects.projectManagerId wins over the earliest projectManagers row", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, projectManagerId: "direct_pm", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: "earliest_pm", addedAt: NOW - 1000 });
    });
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    expect(tasks.every((x) => x.assigneeUserId === "direct_pm")).toBe(true);
  });

  test("PM resolution: falls back to the earliest projectManagers row when projectManagerId is unset", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: "later_pm", addedAt: NOW });
      await ctx.db.insert("projectManagers", { id: "pm2", organizationId: ORG, projectId: "p1", userId: "earlier_pm", addedAt: NOW - 1000 });
    });
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    expect(tasks.every((x) => x.assigneeUserId === "earlier_pm")).toBe(true);
  });

  test("the org's own workTemplates rows override the defaults entirely", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run((ctx) =>
      ctx.db.insert("workTemplates", {
        id: "wt1", organizationId: ORG, title: "Custom kickoff task", stage: "prep",
        triggerStatus: "CONFIRMED", offsetFrom: "trigger", offsetDays: 2, createdAt: NOW, updatedAt: NOW,
      }),
    );
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "Custom kickoff task", stage: "prep", dueDate: NOW + 2 * DAY });
  });

  test("an org's isActive:false template row is excluded from seeding", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("workTemplates", { id: "wt1", organizationId: ORG, title: "Active one", stage: "prep", triggerStatus: "CONFIRMED", offsetFrom: "trigger", offsetDays: 1, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("workTemplates", { id: "wt2", organizationId: ORG, title: "Disabled one", stage: "prep", triggerStatus: "CONFIRMED", offsetFrom: "trigger", offsetDays: 1, isActive: false, createdAt: NOW, updatedAt: NOW });
    });
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    expect(tasks.map((x) => x.title)).toEqual(["Active one"]);
  });

  test("another org's workTemplates rows never leak into this org's seeding", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run((ctx) =>
      ctx.db.insert("workTemplates", { id: "wt1", organizationId: OTHER, title: "Foreign template", stage: "prep", triggerStatus: "CONFIRMED", offsetFrom: "trigger", offsetDays: 1, createdAt: NOW, updatedAt: NOW }),
    );
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p1", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    const tasks = await tasksFor(t, "p1");
    // Falls back to the 5 defaults, not the foreign org's row.
    expect(tasks).toHaveLength(5);
    expect(tasks.every((x) => x.title !== "Foreign template")).toBe(true);
  });

  test("a project from another org is rejected (no cross-tenant seeding)", async () => {
    const t = makeT();
    await t.run((ctx) => ctx.db.insert("projects", { id: "p_foreign", organizationId: OTHER, projectNumber: "PF", name: "Foreign", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW }));
    await t.run((ctx) => maybeSeedWorkTemplates(ctx, { orgId: ORG, projectId: "p_foreign", triggerStatus: "CONFIRMED", actor: ACTOR, now: NOW }));
    expect(await tasksFor(t, "p_foreign")).toHaveLength(0);
  });
});
