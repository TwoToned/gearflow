// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromoteConflictsPanel } from "@/components/projects/finance/promote-conflicts-panel";

describe("PromoteConflictsPanel", () => {
  it("renders nothing when there's no result or no conflicts", () => {
    const { container, rerender } = render(<PromoteConflictsPanel result={null} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();

    rerender(<PromoteConflictsPanel result={{ conflicts: [], liveRevision: 2 }} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a persistent alert listing every conflict and the auto-saved revision", () => {
    render(
      <PromoteConflictsPanel
        result={{ conflicts: ["2 × MA3 Light — checked out, won't be removed automatically."], autoSavedRevision: 5, liveRevision: 2 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/v2 is live — 1 item needs your review/i)).toBeTruthy();
    expect(screen.getByText(/MA3 Light/)).toBeTruthy();
    expect(screen.getByText(/saved as v5/i)).toBeTruthy();
  });

  it("dismisses on click", () => {
    const onDismiss = vi.fn();
    render(<PromoteConflictsPanel result={{ conflicts: ["x"], liveRevision: 2 }} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
