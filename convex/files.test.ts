// @vitest-environment node
//
// convex/files.ts's getOrgStorageUsage (#1077, A7) — per-org Convex `_storage`
// usage for the site-admin org list. Not a quota system, just visibility.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SERVICE = { subject: "gearflow-service", svc: true };
const ORG = "org_1";
const ORG_2 = "org_2";

function makeT() {
  return convexTest(schema, modules);
}

async function storeFile(t: ReturnType<typeof convexTest>, organizationId: string, bytes: string, fileName: string) {
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([bytes]));
    await ctx.db.insert("storedFiles", { storageId, organizationId, fileName, createdAt: 1_700_000_000_000 });
    return storageId;
  });
}

describe("getOrgStorageUsage", () => {
  test("sums file sizes for the requested org only", async () => {
    const t = makeT();
    await storeFile(t, ORG, "12345", "a.txt"); // 5 bytes
    await storeFile(t, ORG, "1234567890", "b.txt"); // 10 bytes
    await storeFile(t, ORG_2, "1", "other-org.txt"); // 1 byte — must not count

    const usage = await t
      .withIdentity(SERVICE)
      .query(api.files.getOrgStorageUsage, { organizationId: ORG });

    expect(usage.fileCount).toBe(2);
    expect(usage.totalBytes).toBe(15);
    expect(usage.truncated).toBe(false);
  });

  test("an org with no files reports zero, not an error", async () => {
    const t = makeT();
    const usage = await t
      .withIdentity(SERVICE)
      .query(api.files.getOrgStorageUsage, { organizationId: "org_with_nothing" });
    expect(usage).toEqual({ fileCount: 0, totalBytes: 0, truncated: false });
  });

  test("rejects a non-service caller", async () => {
    const t = makeT();
    await expect(
      t.withIdentity({ subject: "user_1", orgId: ORG }).query(api.files.getOrgStorageUsage, { organizationId: ORG }),
    ).rejects.toThrow();
  });
});
