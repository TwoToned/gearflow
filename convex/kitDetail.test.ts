// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// import.meta.glob typed via convex/import-meta-glob.d.ts (see convex/rbac.test.ts).
const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const SCANNER = "user_scanner";
const asUser = (orgId: string) => ({ subject: USER, orgId });

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("kits", { id: "k1", organizationId: ORG, assetTag: "K1", name: "Kit One" });

    // A scanner user with full Better-Auth PII — must NOT reach the browser.
    await ctx.db.insert("users", {
      id: SCANNER,
      name: "Scanner Sam",
      email: "sam@secret.example",
      emailVerified: true,
      image: "https://img/sam.png",
      role: "admin",
      banned: false,
      banReason: "n/a",
      twoFactorEnabled: true,
    });
    await ctx.db.insert("assetScanLogs", {
      id: "sl1",
      organizationId: ORG,
      kitId: "k1",
      projectId: undefined,
      action: "SCAN_VERIFY",
      scannedById: SCANNER,
      scannedAt: 1_700_000_000_000,
    });

    // A file with an S3 storageKey — must NOT reach the browser.
    await ctx.db.insert("fileUploads", {
      id: "f1",
      organizationId: ORG,
      fileName: "photo.jpg",
      fileSize: 1234,
      mimeType: "image/jpeg",
      storageKey: "org_1/secret/photo.jpg",
      url: "https://cdn/photo.jpg",
      thumbnailUrl: "https://cdn/photo_thumb.jpg",
      uploadedById: SCANNER,
    });
    await ctx.db.insert("kitMedia", { id: "km1", organizationId: ORG, kitId: "k1", fileId: "f1", type: "PHOTO" });
  });
}

describe("kitDetail.bundle — allowlist DTOs (§3.5)", () => {
  test("users are projected to { id, name } — no PII leaks", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.kitDetail.bundle, { kitId: "k1", orgId: ORG });
    expect(res).not.toBeNull();
    const user = res!.users.find((u) => u.id === SCANNER)!;
    expect(user).toEqual({ id: SCANNER, name: "Scanner Sam" });
    for (const forbidden of ["email", "emailVerified", "image", "role", "banned", "banReason", "twoFactorEnabled"]) {
      expect(user).not.toHaveProperty(forbidden);
    }
  });

  test("the bundle carries the DERIVED state (a LOST member; the reported-missing marker), the page prints that", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("assets", { id: "lost", organizationId: ORG, modelId: "m", assetTag: "L-1", status: "LOST", isActive: true });
      await ctx.db.insert("kitSerializedItems", { id: "ks1", organizationId: ORG, kitId: "k1", assetId: "lost", addedById: "u1" });
    });
    const res = await t.withIdentity(asUser(ORG)).query(api.kitDetail.bundle, { kitId: "k1", orgId: ORG });
    expect(res!.kit.status ?? "AVAILABLE").toBe("AVAILABLE");
    expect(res!.state).toMatchObject({ key: "INCOMPLETE", reportedMissing: false });
    expect(res!.state!.missing[0]).toMatchObject({ label: "L-1", why: "lost" });
    await t.run(async (ctx) => {
      const k = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", "k1")).first();
      await ctx.db.patch(k!._id, { status: "INCOMPLETE" });
      const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", "lost")).first();
      await ctx.db.patch(a!._id, { status: "AVAILABLE" });
    });
    const marker = await t.withIdentity(asUser(ORG)).query(api.kitDetail.bundle, { kitId: "k1", orgId: ORG });
    expect(marker!.state).toMatchObject({ key: "INCOMPLETE", reportedMissing: true, missing: [] });
  });

  test("files are projected to url-only — storageKey / uploadedById absent", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.kitDetail.bundle, { kitId: "k1", orgId: ORG });
    const file = res!.files.find((f) => f.id === "f1")!;
    expect(file).toEqual({ id: "f1", url: "https://cdn/photo.jpg", thumbnailUrl: "https://cdn/photo_thumb.jpg" });
    for (const forbidden of ["storageKey", "uploadedById", "fileName", "fileSize", "mimeType"]) {
      expect(file).not.toHaveProperty(forbidden);
    }
  });
});
