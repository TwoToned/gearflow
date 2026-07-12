// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Control the mobile branch.
let mockIsMobile = false;
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

import { BulkActionBar } from "@/components/ui/bulk-action-bar";

describe("BulkActionBar", () => {
  beforeEach(() => {
    cleanup();
    mockIsMobile = false;
  });

  it("renders nothing when nothing is selected", () => {
    const { container } = render(<BulkActionBar count={0} onClear={() => {}} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("renders an inline toolbar on desktop (no fixed overlay)", () => {
    mockIsMobile = false;
    render(
      <BulkActionBar count={2} onClear={() => {}}>
        <button>Edit</button>
      </BulkActionBar>,
    );
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.textContent).toContain("2 items selected");
    // Desktop bar is in normal flow — not wrapped in a position:fixed overlay.
    expect(toolbar.closest(".fixed")).toBeNull();
  });

  it("singularises the count label", () => {
    render(<BulkActionBar count={1} onClear={() => {}} />);
    expect(screen.getByRole("toolbar").textContent).toContain("1 item selected");
  });

  it("pins the bar in a fixed body-portal overlay on mobile (so the list can't reflow)", () => {
    mockIsMobile = true;
    render(<BulkActionBar count={3} onClear={() => {}} />);
    const toolbar = screen.getByRole("toolbar");
    // Portaled to <body> and wrapped in a fixed, bottom-pinned overlay.
    const overlay = toolbar.closest(".fixed");
    expect(overlay).not.toBeNull();
    expect(overlay?.parentElement).toBe(document.body);
    // Offset above the mobile bottom nav via an inline env() calc. (jsdom's CSSOM
    // reorders the calc() on read-back, so assert the stable safe-area token.)
    expect((overlay as HTMLElement).style.bottom).toContain("safe-area-inset-bottom");
  });
});
