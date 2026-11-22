// @vitest-environment jsdom
//
// UX Phase 7: `JobVersionStrip`, the header's one quiet strip while viewing a
// non-live version. Ports the drift-line cases from the deleted
// `version-strip.smoke.test.tsx` (#1233 drift detection, #1232 D53 drift →
// Compare), plus the strip's own Make live / Back to live.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));

const LIVE = { id: "v4", number: 4, isLive: true, contentState: "ready" as const, createdAt: 1, createdById: "u1" };
const VIEWING = { id: "v3", number: 3, label: "With LED wall", isLive: false, contentState: "ready" as const, createdAt: 1, createdById: "u1" };

let ctx: Record<string, unknown> = {};
const setViewingNumber = vi.fn();
const openCompare = vi.fn();
vi.mock("@/components/projects/project-version-context", async () => {
  const actual = await vi.importActual<typeof import("@/components/projects/project-version-context")>(
    "@/components/projects/project-version-context",
  );
  return { ...actual, useProjectVersion: () => ctx };
});

import { JobVersionStrip } from "@/components/projects/job-version-strip";

function viewing(drift: { quoteId: string; quoteLabel: string; driftAmount: number } | null = null) {
  ctx = {
    isViewingVersion: true,
    viewingVersion: VIEWING,
    liveVersion: LIVE,
    viewingQuoteDrift: drift,
    setViewingNumber,
    openCompare,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("JobVersionStrip", () => {
  it("renders nothing while live", () => {
    ctx = { isViewingVersion: false, viewingVersion: null, liveVersion: LIVE, viewingQuoteDrift: null, setViewingNumber, openCompare };
    const { container } = render(<JobVersionStrip onMakeLive={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("viewing a draft: says what's on screen and offers Make v3 live and Back to live (v4)", () => {
    viewing();
    const onMakeLive = vi.fn();
    render(<JobVersionStrip onMakeLive={onMakeLive} />);
    expect(screen.getByText(/Viewing v3 · With LED wall/)).toBeTruthy();
    expect(screen.getByText(/a draft, editable on Equipment and Finance/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make v3 live" }));
    expect(onMakeLive).toHaveBeenCalledWith(VIEWING);
    fireEvent.click(screen.getByRole("button", { name: "Back to live (v4)" }));
    expect(setViewingNumber).toHaveBeenCalledWith(null);
  });

  describe("quote drift (#1233, ported from version-strip.smoke)", () => {
    const DRIFT = { quoteId: "q87", quoteLabel: "RVLT-2026-0087 v3", driftAmount: 1240 };

    it("renders a drift line when the viewed version's total has moved since it was sent", () => {
      viewing(DRIFT);
      render(<JobVersionStrip onMakeLive={vi.fn()} />);
      expect(screen.getByText(/Quote total has moved \+\$1,240\.00 since RVLT-2026-0087 v3 was sent/)).toBeTruthy();
    });

    it("shows a negative drift with a minus sign", () => {
      viewing({ ...DRIFT, driftAmount: -50.5 });
      render(<JobVersionStrip onMakeLive={vi.fn()} />);
      expect(screen.getByText(/-\$50\.50/)).toBeTruthy();
    });

    it("renders no drift line when driftAmount is exactly zero (nothing has moved)", () => {
      viewing({ ...DRIFT, driftAmount: 0 });
      render(<JobVersionStrip onMakeLive={vi.fn()} />);
      expect(screen.queryByText(/Quote total has moved/)).toBeNull();
    });

    it("renders no drift line when there is no drift record (no quote ever sent for this version)", () => {
      viewing(null);
      render(<JobVersionStrip onMakeLive={vi.fn()} />);
      expect(screen.queryByText(/Quote total has moved/)).toBeNull();
    });

    it("the drift line is a button (Compare is always reachable from the version context)", () => {
      viewing(DRIFT);
      render(<JobVersionStrip onMakeLive={vi.fn()} />);
      const line = screen.getByText(/Quote total has moved/);
      expect(line.closest("button")).toBeTruthy();
      expect(line.closest("a")).toBeNull();
    });

    it("clicking it opens Compare: the sent quote's frozen snapshot against the viewed version (D53)", () => {
      viewing(DRIFT);
      render(<JobVersionStrip onMakeLive={vi.fn()} />);
      fireEvent.click(screen.getByText(/Quote total has moved/).closest("button")!);
      expect(openCompare).toHaveBeenCalledTimes(1);
      expect(openCompare).toHaveBeenCalledWith(
        { kind: "quoteSnapshot", quoteId: "q87", label: "RVLT-2026-0087 v3" },
        { kind: "version", number: 3 },
      );
    });
  });
});
