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
import { buildPrimaryPhotoMap } from "@/lib/media-read";

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
