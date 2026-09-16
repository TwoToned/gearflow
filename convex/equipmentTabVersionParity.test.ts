// @vitest-environment node
//
// #1228 (Phase 2 of "Project versioning v2") — the "viewed-version copy
// parity" requirement: docs/designs/project-versioning-v2.md's own words,
// echoed in equipmentTab.ts's `readEquipmentTab` comment, are that a
// non-live version's Equipment tab must render through the EXACT SAME
// reconstruction as the live tab — no "if this were live" labelling, no
// extra discriminator field, no missing/extra data shape. Proven here, not
// eyeballed: one function (`readEquipmentTab`) is parameterised ONLY by
// which version's rows it reads, so this test seeds a live version and a
// materialized (via `materializeVersionRowsNative`) non-live sibling with
// equivalent content and asserts `equipmentTab.bundle`'s response is
// structurally identical either way — same top-level keys, same per-row
// field set, same content.
import { convexTest } from "convex-test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const USER = { subject: "user_1", orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seedProject(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m-owner", organizationId: ORG, userId: "user_1", role: "owner" });
    await ctx.db.insert("projects", {
      id: "p1", organizationId: ORG, projectNumber: "P1", name: "Gig",
      isTemplate: false, status: "CONFIRMED", liveVersionId: "v-live", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("projectVersions", {
      id: "v-live", organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1",
    });
    await ctx.db.insert("projectVersions", {
      id: "v-nonlive", organizationId: ORG, projectId: "p1", number: 2, contentState: "missing", createdAt: NOW, createdById: "u1",
    });
    await ctx.db.insert("models", { id: "m1", organizationId: ORG, name: "USB Pro DI" });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A-1", status: "AVAILABLE" });
    await ctx.db.insert("projectCategories", {
      id: "cat1", organizationId: ORG, projectId: "p1", versionId: "v-live", lineageId: "cat1", name: "Audio", sortOrder: 0,
    });
    await ctx.db.insert("projectGroups", {
      id: "grp1", organizationId: ORG, projectId: "p1", versionId: "v-live", lineageId: "grp1",
      categoryId: "cat1", title: "Stage", quantity: 1, sortOrder: 0,
    });
    await ctx.db.insert("projectLineItems", {
      id: "li1", organizationId: ORG, projectId: "p1", versionId: "v-live", lineageId: "li1",
      categoryId: "cat1", groupId: "grp1", modelId: "m1", assetId: "a1",
      type: "EQUIPMENT", status: "CONFIRMED", isKitChild: false, quantity: 1,
      unitPrice: 50, lineTotal: 50, description: "USB Pro DI on stage",
    });
  });
}

const bundle = (t: T, versionId?: string) =>
  t.withIdentity(USER).query(api.equipmentTab.bundle, { projectId: "p1", orgId: ORG, ...(versionId ? { versionId } : {}) } as never);

/** Drop the fields that legitimately differ between a live row and its
 *  materialized clone by DESIGN (fresh id/versionId/lineageId/in-clone-set
 *  FKs get remapped ids) — everything else must be byte-identical, or the
 *  tab would render different copy depending on liveness. */
function stripCloneIdentity(row: Record<string, unknown>): Record<string, unknown> {
  const { id, versionId, lineageId, categoryId, groupId, _id, _creationTime, ...rest } = row;
  void id; void versionId; void lineageId; void categoryId; void groupId; void _id; void _creationTime;
  return rest;
}

describe("equipmentTab.bundle — non-live version renders with IDENTICAL shape/copy as live", () => {
  test("same top-level keys, same row counts, same per-row content (live vs. materialized non-live)", async () => {
    const t = makeT();
    await seedProject(t);
    await t.withIdentity(SERVICE).mutation(api.projectVersionsWrites.materializeVersionRowsNative, {
      organizationId: ORG, projectId: "p1", targetVersionId: "v-nonlive",
    } as never);

    const live = (await bundle(t)) as Record<string, unknown[]>;
    const nonLive = (await bundle(t, "v-nonlive")) as Record<string, unknown[]>;

    // No extra "isLive"/"readOnly"/"viewingVersion" discriminator field on
    // either shape — the SAME set of keys either way.
    expect(Object.keys(nonLive).sort()).toEqual(Object.keys(live).sort());

    // Same row counts per bucket — nothing appears/disappears purely because
    // the viewed version isn't live.
    for (const key of Object.keys(live)) {
      expect(nonLive[key], `bucket "${key}" row count differs`).toHaveLength(live[key].length);
    }

    expect(live.lineItems).toHaveLength(1);
    expect(live.categories).toHaveLength(1);
    expect(live.groups).toHaveLength(1);

    // Per-row content is IDENTICAL once the by-design clone-identity fields
    // (id/versionId/lineageId/categoryId/groupId — remapped on purpose, see
    // materializeVersionRowsNative) are stripped — same description, same
    // quantity/price, same field SET (no field present on one side only).
    const liveLine = stripCloneIdentity(live.lineItems[0] as Record<string, unknown>);
    const nonLiveLine = stripCloneIdentity(nonLive.lineItems[0] as Record<string, unknown>);
    expect(nonLiveLine).toEqual(liveLine);
    expect(nonLiveLine.description).toBe("USB Pro DI on stage");

    const liveCat = stripCloneIdentity(live.categories[0] as Record<string, unknown>);
    const nonLiveCat = stripCloneIdentity(nonLive.categories[0] as Record<string, unknown>);
    expect(nonLiveCat).toEqual(liveCat);

    // Reference data (models/assets — static catalog, resolved by id, not by
    // version) is exactly the same either way, as designed.
    expect(nonLive.models).toEqual(live.models);
    expect(nonLive.assets).toEqual(live.assets);
  });

  test("an EXPLICIT versionId pointing at the live version behaves identically to omitting versionId", async () => {
    const t = makeT();
    await seedProject(t);

    const implicit = await bundle(t);
    const explicit = await bundle(t, "v-live");
    expect(explicit).toEqual(implicit);
  });
});
