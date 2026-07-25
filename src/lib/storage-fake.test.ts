import { describe, expect, it } from "vitest";
import { createFakeStorage } from "@/lib/storage-fake";

describe("createFakeStorage", () => {
  it("uploads and captures files in order with stable keys", async () => {
    const storage = createFakeStorage();
    const r1 = await storage.upload(Buffer.from("one"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_1",
      fileName: "one.png",
      mimeType: "image/png",
    });
    const r2 = await storage.upload(Buffer.from("two"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_2",
      fileName: "two.png",
      mimeType: "image/png",
    });

    expect(r1.storageKey).toBe("fake-storage-1");
    expect(r1.url).toBe("/api/files/fake-storage-1");
    expect(r2.storageKey).toBe("fake-storage-2");
    expect(storage.files).toHaveLength(2);
    expect(storage.files.map((f) => f.fileName)).toEqual(["one.png", "two.png"]);
  });

  it("getServeInfo returns the stored file's info, or null if unknown", async () => {
    const storage = createFakeStorage();
    const { storageKey } = await storage.upload(Buffer.from("hello"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_1",
      fileName: "hello.png",
      mimeType: "image/png",
    });

    const info = await storage.getServeInfo(storageKey);
    expect(info).toEqual({
      organizationId: "org_1",
      url: "/api/files/fake-storage-1",
      contentType: "image/png",
      size: 5,
      fileName: "hello.png",
    });

    expect(await storage.getServeInfo("nope")).toBeNull();
  });

  it("delete removes the file", async () => {
    const storage = createFakeStorage();
    const { storageKey } = await storage.upload(Buffer.from("x"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_1",
      fileName: "x.png",
      mimeType: "image/png",
    });

    await storage.delete(storageKey);
    expect(await storage.getServeInfo(storageKey)).toBeNull();
    expect(storage.files).toHaveLength(0);
  });

  it("clear() resets captured state", async () => {
    const storage = createFakeStorage();
    await storage.upload(Buffer.from("x"), {
      organizationId: "org_1",
      folder: "avatars",
      entityId: "ent_1",
      fileName: "x.png",
      mimeType: "image/png",
    });
    storage.clear();
    expect(storage.files).toHaveLength(0);
  });
});
