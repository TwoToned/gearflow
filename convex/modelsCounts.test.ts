// @vitest-environment node
//
// models.counts — browser-native replacement for getModelCounts. Verifies:
// active-only asset/bulkAsset counts per modelId, primary-photo resolution
// (PHOTO + isPrimary modelMedia → file url/thumbnail, org-scoped), non-primary /
// non-photo media ignored, org isolation, and RBAC.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const makeT = () => convexTest(schema, modules);

const seed = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    const asset = (id: string, org: string, modelId: string, isActive = true) =>
      ctx.db.insert("assets", { id, organizationId: org, modelId, assetTag: id, status: "AVAILABLE", isActive });
    const bulk = (id: string, org: string, modelId: string, isActive = true) =>
      ctx.db.insert("bulkAssets", { id, organizationId: org, modelId, assetTag: id, totalQuantity: 1, isActive });
    // mdl1: 2 active assets (1 inactive excluded) + 1 active bulk; mdl2: 1 asset. other-org excluded.
    await asset("a1", ORG, "mdl1");
    await asset("a2", ORG, "mdl1");
    await asset("a3", ORG, "mdl1", false); // inactive → excluded
    await asset("a4", ORG, "mdl2");
    await asset("ax", OTHER, "mdl1"); // other org
    await bulk("b1", ORG, "mdl1");
    await bulk("b2", ORG, "mdl1", false); // inactive → excluded

    // Files + model media: mdl1 has a PHOTO+primary (→ resolves), a non-primary photo
    // (ignored) and a non-photo primary (ignored). mdl2 has none.
    await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "p.png", fileSize: 5, mimeType: "image/png", storageKey: "k1", url: "http://x/p.png", thumbnailUrl: "http://x/p-t.png", uploadedById: USER });
    await ctx.db.insert("modelMedia", { id: "mm1", organizationId: ORG, modelId: "mdl1", fileId: "f1", type: "PHOTO", isPrimary: true });
    await ctx.db.insert("modelMedia", { id: "mm2", organizationId: ORG, modelId: "mdl1", fileId: "f1", type: "PHOTO", isPrimary: false }); // not primary
    await ctx.db.insert("modelMedia", { id: "mm3", organizationId: ORG, modelId: "mdl1", fileId: "f1", type: "MANUAL", isPrimary: true }); // not a photo
  });

describe("models.counts", () => {
  test("active-only counts + primary photo per model; no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const counts = await t.withIdentity(asUser).query(api.models.counts, { orgId: ORG });
    expect(counts.mdl1).toEqual({
      assets: 2, // a1, a2 (a3 inactive, ax other-org)
      bulkAssets: 1, // b1 (b2 inactive)
      media: { url: "http://x/p.png", thumbnailUrl: "http://x/p-t.png" },
    });
    expect(counts.mdl2).toEqual({ assets: 1, bulkAssets: 0, media: null });
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.models.counts, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
