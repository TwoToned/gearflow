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

import { ConfirmStatusImpactDialog } from "@/components/projects/confirm-status-impact-dialog";

describe("ConfirmStatusImpactDialog smoke", () => {
  it("renders without throwing, showing both hard-overbooking and unconfirmed-crew impact", () => {
    render(
      <ConfirmStatusImpactDialog
        open
        impact={{ hardOverbookingModelCount: 2, hardOverbookingQty: 5, unconfirmedCrewCount: 3 }}
        pending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 models would go/)).toBeTruthy();
    expect(screen.getByText(/3 crew assignments on this project aren't confirmed yet/)).toBeTruthy();
  });

  it("calls onConfirm when 'Confirm anyway' is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmStatusImpactDialog
        open
        impact={{ hardOverbookingModelCount: 1, hardOverbookingQty: 1, unconfirmedCrewCount: 0 }}
        pending={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Confirm anyway"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when 'Cancel' is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmStatusImpactDialog
        open
        impact={{ hardOverbookingModelCount: 1, hardOverbookingQty: 1, unconfirmedCrewCount: 0 }}
        pending={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
