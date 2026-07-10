// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const roi = {
  modelId: "rx",
  modelName: "Receiver",
  replacementCost: 2000,
  unitsOwned: 4,
  revenue: 12_000,
  projects: [
    { projectId: "p1", projectNumber: "P-001", name: "Gig", status: "COMPLETED", date: 1_700_000_000_000, revenue: 12_000 },
  ],
  truncated: false,
  scope: "earned" as const,
  fleetCost: 8000,
  payback: 1.5,
  revenuePerUnit: 3000,
  costRecovered: 1,
  stillToRecover: 0,
};

vi.mock("@/server/roi", () => ({
  getModelRoi: vi.fn(async () => roi),
  getFleetRoi: vi.fn(),
}));

import { ModelRoiTab } from "@/components/assets/model-roi-tab";

/**
 * Regression: this tab shipped a `Tooltip` with no `TooltipProvider` ancestor. There
 * is no global provider — every consumer wraps its own. It is a runtime-only failure:
 * typecheck, lint and `next build` all passed, and the tab blew up with "Tooltip must
 * be used within TooltipProvider" the moment a user opened it.
 *
 * Only rendering the component catches this, which is why this file exists.
 */
describe("ModelRoiTab smoke", () => {
  it("renders without throwing, tooltip trigger included", async () => {
    render(<ModelRoiTab modelId="rx" />);

    await waitFor(() => expect(screen.getByLabelText("How revenue is attributed")).toBeTruthy());
    expect(screen.getByText("Revenue attributed")).toBeTruthy();
    expect(screen.getByText("Paid for itself")).toBeTruthy();
  });

  it("the tooltip trigger is a single button, not a button inside a button", async () => {
    render(<ModelRoiTab modelId="rx" />);
    const trigger = await waitFor(() => screen.getByLabelText("How revenue is attributed"));

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.querySelector("button")).toBeNull();
  });

  it("shows the projects that produced the revenue", async () => {
    render(<ModelRoiTab modelId="rx" />);
    await waitFor(() => expect(screen.getByText(/P-001/)).toBeTruthy());
  });
});
