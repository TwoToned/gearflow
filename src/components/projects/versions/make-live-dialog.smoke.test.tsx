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

// The preview is a one-shot read (`useConvex().query`), advisory and fail-open.
const previewQuery = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useConvex: () => ({ query: previewQuery }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const PREVIEW = {
  incomingNumber: 3,
  outgoingNumber: 4,
  lines: { incoming: 44, outgoing: 42 },
  carriedLines: 5,
  packedUnits: 12,
  notOnIncoming: 1,
  modelsWithDemandChange: 2,
  invoiceCount: 1,
  total: { before: 21910, after: 23880 },
  balance: { before: 0, after: 1970 },
  truncated: false,
};

import { MakeLiveDialog } from "@/components/projects/versions/make-live-dialog";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

const TARGET: ProjectVersionSummary = { id: "v3", number: 3, isLive: false, contentState: "ready", createdAt: 1, createdById: "u1" };
const LIVE: ProjectVersionSummary = { id: "v4", number: 4, isLive: true, contentState: "ready", createdAt: 1, createdById: "u1" };

describe("MakeLiveDialog smoke", () => {
  it("shows the calm Warehouse / Availability / Invoices rows from the counts-only preview", async () => {
    previewQuery.mockResolvedValue(PREVIEW);
    render(
      <MakeLiveDialog open onOpenChange={vi.fn()} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: /make v3 live/i });
    expect(within(dialog).getByText(/v4 stays saved/i)).toBeTruthy();
    expect(within(dialog).getByText(/sends nothing to the client/i)).toBeTruthy();
    expect(await within(dialog).findByText(/The pick list follows v3: 44 lines\. 12 packed units carry over/)).toBeTruthy();
    expect(within(dialog).getByText(/1 line with packed gear isn.t on v3/)).toBeTruthy();
    expect(within(dialog).getByText(/Demand changes on 2 models\. Re-checked after, never a block/)).toBeTruthy();
    expect(within(dialog).getByText(/Quote total \$21,910 → \$23,880\. Balance to raise \$0 → \$1,970/)).toBeTruthy();
    expect(previewQuery).toHaveBeenCalledWith(expect.anything(), { organizationId: "org1", projectId: "p1", versionId: "v3" });
    expect(within(dialog).getByRole("button", { name: /^make v3 live$/i })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("FAILS OPEN: a preview that errors shows the static copy and confirm still works", async () => {
    previewQuery.mockRejectedValue(new Error("boom"));
    mockMakeLive.mockResolvedValueOnce({ liveVersionId: "v3", previousLiveVersionId: "v4", conflicts: [], unplannedLineItemIds: [] });
    render(
      <MakeLiveDialog open onOpenChange={vi.fn()} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: /make v3 live/i });
    await waitFor(() => expect(previewQuery).toHaveBeenCalled());
    expect(within(dialog).getByText(/carry over by lineage/i)).toBeTruthy();
    expect(within(dialog).queryByText(/The pick list follows/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /^make v3 live$/i }));
    await waitFor(() => expect(mockMakeLive).toHaveBeenCalledWith("v3"));
  });

  it("a clean make-live toasts with ONE Undo that is server-checked against the expected live pointer", async () => {
    previewQuery.mockResolvedValue(null);
    mockMakeLive.mockResolvedValueOnce({ liveVersionId: "v3", previousLiveVersionId: "v4", conflicts: [], unplannedLineItemIds: [] });
    render(
      <MakeLiveDialog open onOpenChange={vi.fn()} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^make v3 live$/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("v3 is live", expect.objectContaining({ action: expect.anything() })));
    const undo = (toastMock.success.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } }).action.onClick;
    mockMakeLive.mockResolvedValueOnce({ liveVersionId: "v4", previousLiveVersionId: "v3", conflicts: [], unplannedLineItemIds: [] });
    undo();
    await waitFor(() => expect(mockMakeLive).toHaveBeenLastCalledWith("v4", { expectLiveVersionId: "v3" }));
  });

  it("with conflicts there is NO Undo (the flip is no longer an exact inverse)", async () => {
    previewQuery.mockResolvedValue(null);
    mockMakeLive.mockResolvedValueOnce({ liveVersionId: "v3", previousLiveVersionId: "v4", conflicts: ["x"], unplannedLineItemIds: [] });
    render(
      <MakeLiveDialog open onOpenChange={vi.fn()} targetVersion={TARGET} liveVersion={LIVE} projectId="p1" onMadeLive={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^make v3 live$/i }));
    await waitFor(() => expect(screen.getByText(/1 item needs a look/i)).toBeTruthy());
    expect(toastMock.success).not.toHaveBeenCalled();
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
