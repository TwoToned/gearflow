// @vitest-environment node
//
// paletteRecents.resolve (UX Phase 11, §6d.3, Q7): localStorage holds ids only;
// this turns them back into rows. Pinned: bounds (≤ 5 refs), the org check on
// every by_cuid read (a foreign or forged id resolves to nothing), the role
// filter (the same resource table global search uses), and the org guard.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { RECENT_TYPES } from "./lib/paletteRecentRefs";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG };

async function makeT(role = "member"): Promise<T> {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
    await ctx.db.insert("models", { id: "mAura", organizationId: ORG, name: "Aura", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "mAura", assetTag: "AURA-01", status: "AVAILABLE", isActive: true, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projects", {
      id: "p2341", organizationId: ORG, projectNumber: "2341", name: "Hilton gala", status: "CONFIRMED",
      isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Hilton Sydney", isActive: true });
    await ctx.db.insert("clients", { id: "cGone", organizationId: ORG, name: "Archived Co", isActive: false });
    // Another org's job, whose id a forged ref names.
    await ctx.db.insert("projects", {
      id: "pForeign", organizationId: OTHER, projectNumber: "9999", name: "Not yours", status: "CONFIRMED",
      isTemplate: false, createdAt: NOW, updatedAt: NOW,
    });
  });
  return t;
}

const resolve = (t: T, refs: { type: "project" | "asset" | "client" | "model"; id: string }[], orgId = ORG) =>
  t.withIdentity(asUser).query(api.paletteRecents.resolve, { orgId, refs });

describe("paletteRecents.resolve", () => {
  test("resolves refs in order to the same titles and hrefs global search shows", async () => {
    const t = await makeT();
    const rows = await resolve(t, [
      { type: "project", id: "p2341" },
      { type: "asset", id: "a1" },
      { type: "client", id: "c1" },
    ]);
    expect(rows.map((r) => [r.title, r.href])).toEqual([
      ["2341 — Hilton gala", "/projects/p2341"],
      ["AURA-01", "/assets/registry/a1"],
      ["Hilton Sydney", "/clients/c1"],
    ]);
    expect(rows[1].subtitle).toBe("Aura");
  });

  test("another org's row, a missing id and an archived record resolve to nothing", async () => {
    const t = await makeT();
    const rows = await resolve(t, [
      { type: "project", id: "pForeign" },
      { type: "project", id: "nope" },
      { type: "client", id: "cGone" },
      { type: "client", id: "c1" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });

  test("a role that can't read a type gets none of its refs (unknown legacy role ⇒ nothing)", async () => {
    const t = await makeT("legacy-custom");
    expect(await resolve(t, [{ type: "project", id: "p2341" }, { type: "client", id: "c1" }])).toEqual([]);
  });

  test("more than five refs, or an over-long id, is refused", async () => {
    const t = await makeT();
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "client" as const, id: `c${i}` }));
    await expect(resolve(t, six)).rejects.toThrow(/At most 5/);
    await expect(resolve(t, [{ type: "client", id: "x".repeat(65) }])).rejects.toThrow(/too long/);
  });

  test("the validator is RECENT_TYPES: every listed type is accepted, anything else refused", async () => {
    const t = await makeT();
    await expect(t.withIdentity(asUser).query(api.paletteRecents.resolve, { orgId: ORG, refs: RECENT_TYPES.map((type) => ({ type, id: "none" })).slice(0, 5) })).resolves.toEqual([]);
    await expect(t.withIdentity(asUser).query(api.paletteRecents.resolve, { orgId: ORG, refs: RECENT_TYPES.slice(5).map((type) => ({ type, id: "none" })) })).resolves.toEqual([]);
    await expect(
      t.withIdentity(asUser).query(api.paletteRecents.resolve, { orgId: ORG, refs: [{ type: "invoice" as "project", id: "x" }] }),
    ).rejects.toThrow(/Validator/i);
  });

  test("a caller whose org doesn't match is rejected", async () => {
    const t = await makeT();
    await expect(resolve(t, [{ type: "project", id: "pForeign" }], OTHER)).rejects.toThrow(/organization mismatch/i);
  });
});
