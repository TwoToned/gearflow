// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// UnitHistoryPopover (rendered inside the indicator) pulls in getScanLog from the
// warehouse server module — stub it so the smoke test stays client-only.
vi.mock("@/server/warehouse", () => ({ getScanLog: vi.fn(async () => ({ logs: [] })) }));

import { LineAssetsIndicator } from "../line-assets-indicator";

describe("LineAssetsIndicator (smoke)", () => {
  it("renders the tick-circle for a line with serial AND bulk tagged units (no crash, provider present)", () => {
    render(
      <LineAssetsIndicator
        lineItemId="li1"
        modelId="m1"
        units={[
          { id: "u1", status: "CHECKED_OUT", asset: { id: "a1", assetTag: "TTP00090" } },
          { id: "u2", status: "CHECKED_OUT", bulkAsset: { id: "b1", assetTag: "CABLE-01" } },
        ]}
      />,
    );
    // Icon button present, labelled with the count (2 = serial + bulk).
    expect(screen.getByRole("button", { name: /2 assets assigned/i })).toBeTruthy();
  });

  it("renders nothing when the line has no tagged units (keeps the table calm)", () => {
    const { container } = render(
      <LineAssetsIndicator lineItemId="li1" units={[{ id: "u1", status: "CONFIRMED" }]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("falls back to the line-level asset tag when there are no units", () => {
    render(<LineAssetsIndicator lineItemId="li1" lineAssetTag="TTP00042" units={[]} />);
    expect(screen.getByRole("button", { name: /1 asset assigned/i })).toBeTruthy();
  });
});
