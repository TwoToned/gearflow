/**
 * Unit tests for the pure primary-photo map builder (`buildPrimaryPhotoMap`).
 *
 * This replaces the old Prisma read
 * `findMany({ where: { type: "PHOTO", isPrimary: true }, select: { <fk>, file } })`
 * that feeds the reactive lists' photo grafts (getModelCounts / getKitCounts /
 * getAssetRegistryPhotos). The safety property: identical output shape — a parent
 * appears iff it has a PHOTO row flagged primary, with url/thumbnail joined from
 * the file row (missing file → nulls), keyed by the parent fk.
 */
import { describe, it, expect } from "vitest";
import {
  buildPrimaryPhotoMap,
  mapGalleryFile,
  sortGalleryBySortOrder,
} from "@/lib/media-read";
import type { Doc } from "../../convex/_generated/dataModel";

const files = [
  { id: "f1", url: "https://x/1.jpg", thumbnailUrl: "https://x/1_t.jpg" },
  { id: "f2", url: "https://x/2.jpg", thumbnailUrl: null },
];

describe("buildPrimaryPhotoMap", () => {
  it("keeps only PHOTO + isPrimary rows and joins the file url/thumbnail", () => {
    const map = buildPrimaryPhotoMap(
      "modelId",
      [
        { modelId: "m1", type: "PHOTO", isPrimary: true, fileId: "f1" },
        { modelId: "m2", type: "PHOTO", isPrimary: true, fileId: "f2" },
        // not primary → excluded
        { modelId: "m3", type: "PHOTO", isPrimary: false, fileId: "f1" },
        // not a photo → excluded
        { modelId: "m4", type: "DOCUMENT", isPrimary: true, fileId: "f1" },
      ],
      files,
    );
    expect(map).toEqual({
      m1: { url: "https://x/1.jpg", thumbnailUrl: "https://x/1_t.jpg" },
      m2: { url: "https://x/2.jpg", thumbnailUrl: null },
    });
    expect(map.m3).toBeUndefined();
    expect(map.m4).toBeUndefined();
  });

  it("yields null url when the joined file is missing from the mirror (no fallback)", () => {
    const map = buildPrimaryPhotoMap(
      "kitId",
      [{ kitId: "k1", type: "PHOTO", isPrimary: true, fileId: "gone" }],
      files,
    );
    expect(map.k1).toEqual({ url: null, thumbnailUrl: null });
  });

  it("skips rows whose parent fk is not a string", () => {
    const map = buildPrimaryPhotoMap(
      "assetId",
      [{ assetId: null, type: "PHOTO", isPrimary: true, fileId: "f1" }],
      files,
    );
    expect(Object.keys(map)).toHaveLength(0);
  });
});

/**
 * Pure-core tests for the standalone gallery getters (Phase A read-rewiring).
 * The getters themselves need a live Convex backend; these cover the
 * deterministic mapping/sorting that reconstructs the old serialized Prisma
 * shape from the Convex mirror.
 */
describe("mapGalleryFile", () => {
  const baseFile: Doc<"fileUploads"> = {
    _id: "internal" as Doc<"fileUploads">["_id"],
    _creationTime: 0,
    id: "f1",
    organizationId: "org1",
    fileName: "a.jpg",
    fileSize: 123,
    mimeType: "image/jpeg",
    storageKey: "key/a.jpg",
    url: "https://x/a.jpg",
    thumbnailUrl: "https://x/a_t.jpg",
    width: 800,
    height: 600,
    uploadedById: "u1",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
  };

  it("returns null for a missing file (no Prisma fallback)", () => {
    expect(mapGalleryFile(null)).toBeNull();
  });

  it("maps epoch-ms timestamps to Date and preserves business fields", () => {
    const f = mapGalleryFile(baseFile)!;
    expect(f.createdAt).toBeInstanceOf(Date);
    expect(f.createdAt.getTime()).toBe(1_700_000_000_000);
    expect(f.updatedAt.getTime()).toBe(1_700_000_500_000);
    expect(f.url).toBe("https://x/a.jpg");
    expect(f.thumbnailUrl).toBe("https://x/a_t.jpg");
    expect(f.width).toBe(800);
    expect(f.height).toBe(600);
  });

  it("coerces absent optional columns to null", () => {
    const f = mapGalleryFile({
      ...baseFile,
      thumbnailUrl: undefined,
      width: undefined,
      height: undefined,
    })!;
    expect(f.thumbnailUrl).toBeNull();
    expect(f.width).toBeNull();
    expect(f.height).toBeNull();
  });

  it("coerces absent timestamps to the epoch (never NaN/Invalid Date)", () => {
    const f = mapGalleryFile({ ...baseFile, createdAt: undefined, updatedAt: undefined })!;
    expect(f.createdAt.getTime()).toBe(0);
    expect(f.updatedAt.getTime()).toBe(0);
  });
});

describe("sortGalleryBySortOrder", () => {
  it("orders ascending by sortOrder (Prisma orderBy parity)", () => {
    const rows = [{ id: "c", sortOrder: 2 }, { id: "a", sortOrder: 0 }, { id: "b", sortOrder: 1 }];
    expect(sortGalleryBySortOrder(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("treats an absent sortOrder as 0 (the Prisma default)", () => {
    const rows = [{ id: "x", sortOrder: 1 }, { id: "y" }];
    expect(sortGalleryBySortOrder(rows).map((r) => r.id)).toEqual(["y", "x"]);
  });

  it("is stable for ties and does not mutate the input", () => {
    const rows = [{ id: "p", sortOrder: 5 }, { id: "q", sortOrder: 5 }];
    const sorted = sortGalleryBySortOrder(rows);
    expect(sorted.map((r) => r.id)).toEqual(["p", "q"]);
    expect(rows[0].id).toBe("p");
  });
});
