// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix, "Option A" (docs/designs/
// perf-convex-efficiency-2026-06.md): AssetGallery used to mount 4 whole-org
// live subscriptions (useAssets/useModels/useLocations/useCategories) and
// filter/join/sort client-side. It now calls assets.listGallery (server-side
// filter + join + sort) via useAuthedQuery. This test pins that the gallery
// renders correctly off a listGallery-shaped result, grouped by category — no
// live Convex client needed.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: { assetPhotos: {}, modelPhotos: {} } }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: vi.fn(async () => ({ assetPhotos: {}, modelPhotos: {} })) }),
  useConvexAuth: () => ({ isAuthenticated: true }),
}));

const GALLERY_ROWS = [
  {
    id: "a1",
    assetTag: "CON-001",
    status: "AVAILABLE",
    condition: "GOOD",
    modelId: "m-avid",
    model: { id: "m-avid", name: "Avid S6 Console", category: null },
    location: null,
  },
  {
    id: "a2",
    assetTag: "MIC-001",
    status: "AVAILABLE",
    condition: "GOOD",
    modelId: "m-shure",
    model: { id: "m-shure", name: "Shure QLXD Receiver", category: { id: "cat1", name: "Microphones" } },
    location: null,
  },
];

let lastGalleryArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "assets:listGallery") {
        lastGalleryArgs = args;
        return GALLERY_ROWS;
      }
      return undefined;
    },
  };
});

import { AssetGallery } from "../asset-gallery";

describe("AssetGallery (smoke)", () => {
  it("renders every asset from assets.listGallery, grouped by category", () => {
    render(<AssetGallery />);
    expect(screen.getByText("Avid S6 Console")).toBeTruthy();
    expect(screen.getByText("Shure QLXD Receiver")).toBeTruthy();
    // Category headers: named category + "Uncategorised" fallback.
    expect(screen.getByText("Microphones")).toBeTruthy();
    expect(screen.getByText("Uncategorised")).toBeTruthy();
  });

  it("passes the current org id (no client-side whole-org read)", () => {
    render(<AssetGallery />);
    expect(lastGalleryArgs).toMatchObject({ orgId: "org1" });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<AssetGallery />);
    const input = screen.getByPlaceholderText("Search by tag, serial, or name…");
    fireEvent.change(input, { target: { value: "shure" } });
    expect((lastGalleryArgs as { search?: string })?.search).toBeUndefined();
  });
});
