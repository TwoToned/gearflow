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
  costRedacted: false,
  payback: 1.5,
  revenuePerUnit: 3000,
  costRecovered: 1,
  stillToRecover: 0,
};

vi.mock("@/hooks/use-roi", () => ({
  useModelRoi: vi.fn(() => ({ data: roi, isLoading: false })),
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
  });

  it("hides cost and payback until `Show cost & payback`, and hides the toggle for a redacted caller", async () => {
    const { useModelRoi } = await import("@/hooks/use-roi");
    const { cleanup } = await import("@testing-library/react");
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<ModelRoiTab modelId="rx" />);
    await waitFor(() => expect(screen.getByText("Revenue attributed")).toBeTruthy());
    expect(screen.queryByText("Paid for itself")).toBeNull();
    expect(screen.queryByText("Cost recovered")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show cost & payback" }));
    expect(screen.getByText("Paid for itself")).toBeTruthy();
    expect(screen.getByText("Cost recovered")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Hide cost & payback" }));
    expect(screen.queryByText("Paid for itself")).toBeNull();

    cleanup();
    vi.mocked(useModelRoi).mockReturnValue({ data: { ...roi, fleetCost: null, costRedacted: true } as never, isLoading: false });
    render(<ModelRoiTab modelId="rx" />);
    await waitFor(() => expect(screen.getByText("Revenue attributed")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /cost & payback/ })).toBeNull();
    expect(screen.queryByText("Paid for itself")).toBeNull();
  });

  it("the tooltip trigger is a single button, not a button inside a button", async () => {
    render(<ModelRoiTab modelId="rx" />);
    const trigger = await waitFor(() => screen.getByLabelText("How revenue is attributed"));

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.querySelector("button")).toBeNull();
  });

  it("shows the projects that produced the revenue", async () => {
    render(<ModelRoiTab modelId="rx" />);
    // The projects list renders both a desktop table (hidden md:block) and a
    // mobile MobileCardList (md:hidden); jsdom applies no CSS, so the row text
    // appears in both DOM branches. Assert at least one is present.
    await waitFor(() => expect(screen.getAllByText(/P-001/).length).toBeGreaterThan(0));
  });
});
