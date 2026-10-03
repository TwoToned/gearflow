// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { DateMoveImpactDialog } from "@/components/projects/date-move-impact-dialog";

const ROW = { modelId: "m1", modelName: "Shure SM58", qty: 3, projectNumbers: ["P-1042", "P-1051"] };

describe("DateMoveImpactDialog smoke", () => {
  it("renders without throwing, listing the shortage row with the also-booked-on projects", () => {
    render(<DateMoveImpactDialog open rows={[ROW]} pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Moving these dates creates a shortage/)).toBeTruthy();
    expect(screen.getByText(/3 × Shure SM58 — also booked on P-1042, P-1051/)).toBeTruthy();
    expect(screen.getByText(/heads-up, not a block/)).toBeTruthy();
  });

  it("shows only the first 5 rows plus a '+N more' line", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ modelId: `m${i}`, modelName: `Model ${i}`, qty: 1, projectNumbers: ["P-1"] }));
    render(<DateMoveImpactDialog open rows={rows} pending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Model 0", { exact: false })).toBeTruthy();
    expect(screen.queryByText(/Model 5/)).toBeNull();
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("calls onConfirm when 'Save anyway' is clicked", () => {
    const onConfirm = vi.fn();
    render(<DateMoveImpactDialog open rows={[ROW]} pending={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Save anyway"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when 'Cancel' is clicked", () => {
    const onCancel = vi.fn();
    render(<DateMoveImpactDialog open rows={[ROW]} pending={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
