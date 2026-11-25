// @vitest-environment node
//
// `fileUploads.removeIfUnreferenced`: the Convex half of the legacy server removal path (sub-hire media,
// `src/lib/media-write.ts`). Service-only; deletes a file (bytes, thumbnail, records) only when nothing holds it.
import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

type T = TestConvex<typeof schema>;
const ORG = "org_1", OTHER = "org_2";
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = (): T => convexTest(schema, import.meta.glob("./**/*.ts"));

async function seed(t: T, org = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("fileUploads", { id: "f", organizationId: org, fileName: "f.png", fileSize: 1, mimeType: "image/png", storageKey: "k_f", url: "/api/files/k_f", thumbnailUrl: "/api/files/k_t", uploadedById: "u" });
    await ctx.db.insert("storedFiles", { storageId: "k_f", organizationId: org, folder: "sub-hires" });
    await ctx.db.insert("storedFiles", { storageId: "k_t", organizationId: org, folder: "sub-hires" });
  });
}
const remove = (t: T, orgId = ORG) => t.withIdentity(SERVICE).mutation(api.fileUploads.removeIfUnreferenced, { orgId, fileId: "f" });
const left = (t: T) => t.run(async (ctx) => ({ file: await ctx.db.query("fileUploads").first(), stored: (await ctx.db.query("storedFiles").collect()).length }));

describe("fileUploads.removeIfUnreferenced", () => {
  test("a file another sub-hire media row still holds survives; the last holder's removal deletes it and its thumbnail record", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => { await ctx.db.insert("subHireMedia", { id: "sm2", organizationId: ORG, subHireId: "b", fileId: "f" } as never); });
    expect(await remove(t)).toBe(false);
    expect(await left(t)).toMatchObject({ file: expect.objectContaining({ id: "f" }), stored: 2 });
    await t.run(async (ctx) => { await ctx.db.delete((await ctx.db.query("subHireMedia").first())!._id); });
    expect(await remove(t)).toBe(true);
    expect(await left(t)).toEqual({ file: null, stored: 0 });
  });

  test("another org's file is never deleted, and a caller that is not the service is refused", async () => {
    const t = makeT(); await seed(t, OTHER);
    expect(await remove(t, ORG)).toBe(false);
    expect((await left(t)).file).not.toBeNull();
    await expect(t.withIdentity({ subject: "u", orgId: ORG, role: "admin" }).mutation(api.fileUploads.removeIfUnreferenced, { orgId: ORG, fileId: "f" })).rejects.toThrow();
  });
});
