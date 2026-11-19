// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrepStatusBadge } from "@/components/warehouse/prep-status-badge";
import type { LineItem } from "@/components/warehouse/warehouse-types";

const item = (over: Partial<LineItem>) => ({ prepStatus: "PACKED", status: "CONFIRMED", ...over }) as LineItem;

describe("PrepStatusBadge", () => {
  it("returned gear reads Returned, never Prepped (§1.1 chip bug)", () => {
    render(<PrepStatusBadge item={item({ status: "RETURNED" })} />);
    expect(screen.getByText("Returned")).toBeTruthy();
    expect(screen.queryByText("Prepped")).toBeNull();
  });
  it("packed reads Prepped; pending reads To pick; pulled keeps its hint", () => {
    const { unmount } = render(<PrepStatusBadge item={item({})} />);
    expect(screen.getByText("Prepped")).toBeTruthy();
    unmount();
    render(<PrepStatusBadge item={item({ prepStatus: "PULLED" })} />);
    expect(screen.getByText(/To pick/)).toBeTruthy();
    expect(screen.getByText(/pulled/)).toBeTruthy();
  });
});
