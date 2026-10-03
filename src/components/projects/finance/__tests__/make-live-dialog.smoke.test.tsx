// @vitest-environment jsdom
//
// Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.5) — the
// Make-live dialog: opens as a `Dialog` (no AlertDialog exists, CLAUDE.md),
// states what changes before it runs, and lists the `conflicts: string[]`
// `makeLiveNative` returns (never blocks on them).
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

beforeEach(() => {
  vi.clearAllMocks();
});

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const mockMakeLive = vi.fn();
vi.mock("@/hooks/use-project-version-writes", () => ({
  useProjectVersionWrites: () => ({ makeLive: mockMakeLive, createVersion: vi.fn(), setLabel: vi.fn(), deleteVersion: vi.fn() }),
}));

import { MakeLiveDialog } from "@/components/projects/finance/make-live-dialog";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

const TARGET: ProjectVersionSummary = { id: "v3", number: 3, isLive: false, contentState: "ready", createdAt: 1, createdById: "u1" };
const LIVE: ProjectVersionSummary = { id: "v4", number: 4, isLive: true, contentState: "ready", createdAt: 1, createdById: "u1" };

describe("MakeLiveDialog smoke", () => {
  it("states what changes and offers Make live / Cancel", () => {
    render(
      <MakeLiveDialog open onOpenChange={vi.fn()} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: /make v3 live/i });
    expect(within(dialog).getByText(/v4 stays as a saved version/i)).toBeTruthy();
    expect(within(dialog).getByText(/carry over by lineage/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^make v3 live$/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("with no conflicts: confirms, calls makeLive, and closes itself", async () => {
    mockMakeLive.mockResolvedValueOnce({ liveVersionId: "v3", previousLiveVersionId: "v4", conflicts: [], unplannedLineItemIds: [] });
    const onOpenChange = vi.fn();
    const onMadeLive = vi.fn();
    render(
      <MakeLiveDialog open onOpenChange={onOpenChange} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={onMadeLive} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^make v3 live$/i }));
    await waitFor(() => expect(mockMakeLive).toHaveBeenCalledWith("v3"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onMadeLive).toHaveBeenCalledWith({ liveVersionId: "v3", previousLiveVersionId: "v4", conflicts: [], unplannedLineItemIds: [] });
  });

  it("with conflicts: lists them, stays open, and Done closes it", async () => {
    mockMakeLive.mockResolvedValueOnce({
      liveVersionId: "v3",
      previousLiveVersionId: "v4",
      conflicts: ["2 checked-out units of MA3 Light were on v4 — they stay on the job, flagged unplanned on v3."],
      unplannedLineItemIds: ["li1"],
    });
    const onOpenChange = vi.fn();
    render(
      <MakeLiveDialog open onOpenChange={onOpenChange} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^make v3 live$/i }));

    await waitFor(() => expect(screen.getByText(/1 item needs a look/i)).toBeTruthy());
    expect(screen.getByText(/stay on the job, flagged unplanned/i)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Cancel closes without calling makeLive", () => {
    const onOpenChange = vi.fn();
    render(
      <MakeLiveDialog open onOpenChange={onOpenChange} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMakeLive).not.toHaveBeenCalled();
  });
});
