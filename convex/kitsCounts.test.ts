// @vitest-environment node
//
// kits.counts — browser-native replacement for getKitCounts. Verifies: member
// counts per kitId (kitSerializedItems + kitBulkItems, countKitMembers parity),
// primary-photo resolution (PHOTO + isPrimary kitMedia → file, org-scoped),
// non-primary/non-photo media ignored, org isolation, and RBAC.
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
    const ser = (id: string, org: string, kitId: string) =>
      ctx.db.insert("kitSerializedItems", { id, organizationId: org, kitId, assetId: "a" + id, addedById: USER });
    const blk = (id: string, org: string, kitId: string) =>
      ctx.db.insert("kitBulkItems", { id, organizationId: org, kitId, bulkAssetId: "b" + id, quantity: 1, addedById: USER });
    // kit1: 2 serialized + 1 bulk; kit2: 1 serialized. other-org excluded.
    await ser("s1", ORG, "kit1");
    await ser("s2", ORG, "kit1");
    await ser("s3", ORG, "kit2");
    await ser("sx", OTHER, "kit1"); // other org
    await blk("bl1", ORG, "kit1");
    await blk("blx", OTHER, "kit1"); // other org

    // Files + kit media: kit1 PHOTO+primary (resolves); a non-primary + a non-photo (ignored).
    await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "p.png", fileSize: 5, mimeType: "image/png", storageKey: "k1", url: "http://x/p.png", thumbnailUrl: "http://x/p-t.png", uploadedById: USER });
    await ctx.db.insert("kitMedia", { id: "km1", organizationId: ORG, kitId: "kit1", fileId: "f1", type: "PHOTO", isPrimary: true });
    await ctx.db.insert("kitMedia", { id: "km2", organizationId: ORG, kitId: "kit1", fileId: "f1", type: "PHOTO", isPrimary: false });
    await ctx.db.insert("kitMedia", { id: "km3", organizationId: ORG, kitId: "kit1", fileId: "f1", type: "MANUAL", isPrimary: true });
  });

describe("kits.counts", () => {
  test("member counts + primary photo per kit; no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const counts = await t.withIdentity(asUser).query(api.kits.counts, { orgId: ORG });
    expect(counts.kit1).toEqual({
      serializedItems: 2, // s1, s2 (sx other-org)
      bulkItems: 1, // bl1 (blx other-org)
      media: { url: "http://x/p.png", thumbnailUrl: "http://x/p-t.png" },
    });
    expect(counts.kit2).toEqual({ serializedItems: 1, bulkItems: 0, media: null });
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.kits.counts, { orgId: ORG }),
    ).rejects.toThrow();
  });
});
