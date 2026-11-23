// @vitest-environment jsdom
// UX Phase 8 — the ONE Compare sheet and ONE Make-live dialog, driven by the
// version context: nothing renders while closed; Make live from Compare hands
// off to the dialog; a clean make-live closes it and returns to the live view.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

const V = (n: number, over: Partial<ProjectVersionSummary> = {}): ProjectVersionSummary => ({
  id: `v${n}`, number: n, isLive: false, contentState: "ready", createdAt: 1, createdById: "u1", ...over,
});
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/components/projects/project-version-context", () => ({ useProjectVersion: () => state.value }));

vi.mock("@/components/projects/compare/compare-sheet", () => ({
  CompareSheet: (p: { onMakeLive: (n: number) => void; onOpenChange: (o: boolean) => void }) => (
    <div>
      <p>compare sheet open</p>
      <button onClick={() => p.onMakeLive(2)}>sheet make live</button>
      <button onClick={() => p.onOpenChange(false)}>sheet close</button>
    </div>
  ),
}));
vi.mock("@/components/projects/versions/make-live-dialog", () => ({
  MakeLiveDialog: (p: { targetVersion: { number: number }; onMadeLive: (r: { conflicts: string[] }) => void }) => (
    <div>
      <p>make live dialog v{p.targetVersion.number}</p>
      <button onClick={() => p.onMadeLive({ conflicts: [] })}>made live</button>
      <button onClick={() => p.onMadeLive({ conflicts: ["x"] })}>made live with conflicts</button>
    </div>
  ),
}));

import { VersionOverlays } from "./version-overlays";

const fns = { openCompare: vi.fn(), closeCompare: vi.fn(), openMakeLive: vi.fn(), closeMakeLive: vi.fn(), setViewingNumber: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  const live = V(3, { isLive: true });
  state.value = { projectId: "p1", orgId: "o1", versions: [V(1), V(2), live], liveVersion: live, compare: null, makeLiveTarget: null, ...fns };
});

describe("VersionOverlays", () => {
  it("renders nothing while both are closed", () => {
    const { container } = render(<VersionOverlays />);
    expect(container.textContent).toBe("");
  });

  it("Make live from the Compare sheet opens the ONE dialog for that version; closing the sheet clears compare", async () => {
    const user = userEvent.setup();
    state.value = { ...state.value, compare: { a: { kind: "version", number: null }, b: { kind: "version", number: 2 } } };
    render(<VersionOverlays />);
    expect(screen.getByText("compare sheet open")).toBeTruthy();
    await user.click(screen.getByText("sheet make live"));
    expect(fns.openMakeLive).toHaveBeenCalledWith(expect.objectContaining({ number: 2 }));
    await user.click(screen.getByText("sheet close"));
    expect(fns.closeCompare).toHaveBeenCalled();
  });

  it("a clean make-live closes the dialog and returns to the live view; conflicts keep it open", async () => {
    const user = userEvent.setup();
    state.value = { ...state.value, makeLiveTarget: V(2) };
    render(<VersionOverlays />);
    expect(screen.getByText("make live dialog v2")).toBeTruthy();
    await user.click(screen.getByText("made live with conflicts"));
    expect(fns.closeMakeLive).not.toHaveBeenCalled();
    await user.click(screen.getByText("made live"));
    expect(fns.closeMakeLive).toHaveBeenCalled();
    expect(fns.setViewingNumber).toHaveBeenCalledWith(null);
  });
});
