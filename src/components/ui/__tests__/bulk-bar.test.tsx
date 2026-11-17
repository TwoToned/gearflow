// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BulkAction } from "@/lib/primitives/types";

// Control the mobile branch.
let mockIsMobile = false;
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

const showError = vi.fn();
vi.mock("@/lib/show-error", () => ({ showError: (e: unknown) => showError(e) }));

import { BulkBar, orderBulkActions } from "@/components/ui/bulk-bar";

const act = (key: string, extra: Partial<BulkAction> = {}): BulkAction => ({
  key,
  group: "edit",
  label: (n) => `${key} ${n}`,
  onSelect: vi.fn(),
  ...extra,
});

describe("BulkBar", () => {
  beforeEach(() => {
    cleanup();
    mockIsMobile = false;
  });

  it("renders nothing when nothing is selected", () => {
    const { container } = render(<BulkBar selection={{ count: 0, clear: () => {} }} actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("puts the count in the verb and ✕ clears", () => {
    const clear = vi.fn();
    const move = act("Move");
    render(<BulkBar selection={{ count: 3, clear }} actions={[move]} noun="line" />);
    expect(screen.getByText("3 lines selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move 3" }));
    expect(move.onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("orders danger verbs last", () => {
    const out = orderBulkActions([act("D", { danger: true }), act("A"), act("B")]);
    expect(out.map((a) => a.key)).toEqual(["A", "B", "D"]);
  });

  it("desktop stays inline in the render container", () => {
    const { container } = render(<BulkBar selection={{ count: 1, clear: () => {} }} actions={[]} />);
    expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
  });

  it("phone portals the bar to body, pinned above the bottom nav", () => {
    mockIsMobile = true;
    const { container } = render(<BulkBar selection={{ count: 2, clear: () => {} }} actions={[]} />);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    const bar = document.body.querySelector('[role="toolbar"]') as HTMLElement;
    expect(bar).toBeTruthy();
    const wrap = bar.parentElement as HTMLElement;
    expect(wrap.parentElement).toBe(document.body);
    expect(wrap.style.bottom).toContain("env(safe-area-inset-bottom");
  });

  it("a destructive verb asks first and only then fires", async () => {
    const del = act("Delete", {
      danger: true,
      confirm: { title: "Delete 2 lines?", body: "Reservations are released.", confirmLabel: "Delete lines" },
    });
    render(<BulkBar selection={{ count: 2, clear: () => {} }} actions={[del]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    expect(del.onSelect).not.toHaveBeenCalled();
    expect(await screen.findByText("Delete 2 lines?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete lines" }));
    await waitFor(() => expect(del.onSelect).toHaveBeenCalledTimes(1));
  });

  it("a verb with children opens a menu of sub-items", async () => {
    const pick = vi.fn();
    const status = act("Set status", { children: [act("Confirmed", { onSelect: pick })] });
    render(<BulkBar selection={{ count: 4, clear: () => {} }} actions={[status]} />);
    await userEvent.click(screen.getByRole("button", { name: /Set status 4/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Confirmed 4" }));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("sub-items open as the phone bottom sheet through the one ActionMenu", async () => {
    mockIsMobile = true;
    const pick = vi.fn();
    const status = act("Set status", { children: [act("Confirmed", { onSelect: pick })] });
    render(<BulkBar selection={{ count: 4, clear: () => {} }} actions={[status]} />);
    await userEvent.click(screen.getByRole("button", { name: /Set status 4/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmed 4" }));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it("a rejecting verb is surfaced, not left unhandled (plain, confirm and sub-item)", async () => {
    showError.mockClear();
    const boom = new Error("nope");
    const plain = act("Move", { onSelect: vi.fn().mockRejectedValue(boom) });
    const del = act("Delete", {
      danger: true,
      onSelect: vi.fn().mockRejectedValue(boom),
      confirm: { title: "Delete?", body: "b", confirmLabel: "Delete lines" },
    });
    const sub = act("Status", { children: [act("Confirmed", { onSelect: vi.fn().mockRejectedValue(boom) })] });
    render(<BulkBar selection={{ count: 2, clear: () => {} }} actions={[plain, sub, del]} />);
    await userEvent.click(screen.getByRole("button", { name: "Move 2" }));
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: /Status 2/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Confirmed 2" }));
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete lines" }));
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(3));
  });
});
