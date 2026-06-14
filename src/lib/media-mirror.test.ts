/**
 * Unit tests for the pure projection in media-mirror (`mediaDoc`).
 *
 * The mirror's correctness rests on projecting ONLY the scalar columns of a
 * media row before it reaches the strict Convex create validator — several call
 * sites carry a nested `file` relation include, and only model/asset/kit media
 * carry the `isPrimary` flag (project/client/location/subHire media don't, so
 * their Convex validators reject it).
 */
import { describe, it, expect } from "vitest";
import { mediaDoc } from "@/lib/media-mirror";

const baseRow = {
  id: "m1",
  organizationId: "org1",
  fileId: "f1",
  type: "PHOTO",
  displayName: "Front",
  sortOrder: 2,
  createdAt: new Date("2026-06-10T00:00:00Z"),
  // nested relation include several call sites carry — must be stripped
  file: { id: "f1", url: "https://x/y.jpg", storageKey: "k" },
};

describe("mediaDoc", () => {
  it("strips the nested `file` relation include", () => {
    const doc = mediaDoc("model", { ...baseRow, modelId: "mod1", isPrimary: true });
    expect("file" in doc).toBe(false);
  });

  it("projects isPrimary + the parent fk for model/asset/kit media", () => {
    expect(mediaDoc("model", { ...baseRow, modelId: "mod1", isPrimary: true })).toEqual({
      id: "m1",
      organizationId: "org1",
      fileId: "f1",
      type: "PHOTO",
      displayName: "Front",
      sortOrder: 2,
      createdAt: baseRow.createdAt,
      isPrimary: true,
      modelId: "mod1",
    });
    expect(mediaDoc("asset", { ...baseRow, assetId: "a1", isPrimary: false })).toMatchObject({
      assetId: "a1",
      isPrimary: false,
    });
    expect(mediaDoc("kit", { ...baseRow, kitId: "k1", isPrimary: true })).toMatchObject({
      kitId: "k1",
      isPrimary: true,
    });
  });

  it("omits isPrimary for project/client/location/subHire media (their schema has no such column)", () => {
    // Even if an isPrimary somehow appears on the row, it must not be projected.
    const project = mediaDoc("project", { ...baseRow, projectId: "p1", isPrimary: true });
    expect("isPrimary" in project).toBe(false);
    expect(project).toMatchObject({ projectId: "p1" });

    expect("isPrimary" in mediaDoc("client", { ...baseRow, clientId: "c1" })).toBe(false);
    expect("isPrimary" in mediaDoc("location", { ...baseRow, locationId: "l1" })).toBe(false);
    expect("isPrimary" in mediaDoc("subHire", { ...baseRow, subHireId: "s1" })).toBe(false);
  });

  it("omits absent optional fields rather than emitting undefined keys", () => {
    const doc = mediaDoc("location", {
      id: "m2",
      organizationId: "org1",
      fileId: "f2",
      type: "DOCUMENT",
      sortOrder: 0,
      createdAt: baseRow.createdAt,
      locationId: "l1",
    });
    expect("displayName" in doc).toBe(false);
  });
});
