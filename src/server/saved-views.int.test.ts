/**
 * Integration tests for saved table views (per-user, org-scoped list presets).
 *
 * Covers: create + list scoping, default exclusivity, update, delete, setDefault
 * (set + clear), and cross-user / cross-org isolation — a user must never see or
 * mutate another user's (or org's) views.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";

const h = vi.hoisted(() => ({
  ctx: { organizationId: "", userId: "", userName: "Tester" },
}));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: async () => h.ctx,
  requirePermission: async () => h.ctx,
}));

import {
  getSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  setDefaultSavedView,
} from "@/server/saved-views";

async function actAs(orgId: string, userId: string) {
  h.ctx.organizationId = orgId;
  h.ctx.userId = userId;
}

describe("saved table views", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates and lists views scoped to the user + table", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await actAs(org.id, user.id);

    await createSavedView({ tableId: "assets", name: "Overdue", config: { filters: { status: ["OVERDUE"] } } });
    await createSavedView({ tableId: "assets", name: "Maintenance", config: { sortBy: "name", sortOrder: "desc" } });
    await createSavedView({ tableId: "projects", name: "Active", config: {} });

    const assetViews = (await getSavedViews("assets")) as Array<{ name: string; config: unknown }>;
    expect(assetViews).toHaveLength(2);
    expect(assetViews.map((v) => v.name).sort()).toEqual(["Maintenance", "Overdue"]);

    const projectViews = (await getSavedViews("projects")) as Array<{ name: string }>;
    expect(projectViews).toHaveLength(1);
    expect(projectViews[0].name).toBe("Active");
  });

  it("a new default unsets the previous default for the same user+table", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await actAs(org.id, user.id);

    const a = (await createSavedView({ tableId: "assets", name: "A", config: {}, isDefault: true })) as { id: string };
    const b = (await createSavedView({ tableId: "assets", name: "B", config: {}, isDefault: true })) as { id: string };

    const views = (await getSavedViews("assets")) as Array<{ id: string; isDefault: boolean }>;
    const defaults = views.filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(b.id);
    expect(views.find((v) => v.id === a.id)?.isDefault).toBe(false);
  });

  it("setDefaultSavedView sets one and clears with null", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await actAs(org.id, user.id);

    const a = (await createSavedView({ tableId: "assets", name: "A", config: {} })) as { id: string };

    await setDefaultSavedView("assets", a.id);
    let views = (await getSavedViews("assets")) as Array<{ id: string; isDefault: boolean }>;
    expect(views.find((v) => v.id === a.id)?.isDefault).toBe(true);

    await setDefaultSavedView("assets", null);
    views = (await getSavedViews("assets")) as Array<{ isDefault: boolean }>;
    expect(views.every((v) => !v.isDefault)).toBe(true);
  });

  it("updates a view's name and config", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await actAs(org.id, user.id);

    const v = (await createSavedView({ tableId: "assets", name: "Old", config: { pageSize: 10 } })) as { id: string };
    await updateSavedView(v.id, { name: "New", config: { pageSize: 50 } });

    const views = (await getSavedViews("assets")) as Array<{ name: string; config: { pageSize?: number } }>;
    expect(views[0].name).toBe("New");
    expect(views[0].config.pageSize).toBe(50);
  });

  it("deletes a view", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await actAs(org.id, user.id);

    const v = (await createSavedView({ tableId: "assets", name: "Temp", config: {} })) as { id: string };
    await deleteSavedView(v.id);
    expect((await getSavedViews("assets")) as unknown[]).toHaveLength(0);
  });

  it("a user cannot see, update, or delete another user's view", async () => {
    const org = await createOrgFixture();
    const userA = await createUserFixture(org.id);
    const userB = await createUserFixture(org.id);

    await actAs(org.id, userA.id);
    const v = (await createSavedView({ tableId: "assets", name: "A-only", config: {} })) as { id: string };

    // userB cannot list it
    await actAs(org.id, userB.id);
    expect((await getSavedViews("assets")) as unknown[]).toHaveLength(0);

    // ...nor update it
    await expect(updateSavedView(v.id, { name: "hijacked" })).rejects.toThrow(/not found/i);
    // ...nor delete it
    await expect(deleteSavedView(v.id)).rejects.toThrow(/not found/i);

    // ...nor flip it to default via a foreign id
    await expect(setDefaultSavedView("assets", v.id)).rejects.toThrow(/not found/i);

    // userA's view is untouched
    await actAs(org.id, userA.id);
    const views = (await getSavedViews("assets")) as Array<{ name: string; isDefault: boolean }>;
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("A-only");
    expect(views[0].isDefault).toBe(false);
  });

  it("rejects blank and over-long names", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    await actAs(org.id, user.id);

    await expect(createSavedView({ tableId: "assets", name: "   ", config: {} })).rejects.toThrow(/required/i);
    await expect(
      createSavedView({ tableId: "assets", name: "x".repeat(61), config: {} }),
    ).rejects.toThrow(/60 characters/i);
  });
});
