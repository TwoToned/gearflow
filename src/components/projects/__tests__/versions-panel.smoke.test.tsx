// @vitest-environment jsdom
//
// Project Versioning v2, Phase 5 (#1231, parent #1221, design §5.1) — the
// Versions panel: the sheet must actually OPEN and list every version with
// its state/date, and each row's actions (rename/make-live/delete) must
// match its eligibility. `Sheet` is Radix (`@radix-ui/react-dialog` under
// the hood) — asserted here by role="dialog", not eyeballed.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));

const mockCreateVersion = vi.fn(async () => ({ id: "v5", number: 5 }));
const mockMakeLive = vi.fn(async () => ({ liveVersionId: "v3", previousLiveVersionId: "v4", conflicts: [] as string[], unplannedLineItemIds: [] }));
const mockSetLabel = vi.fn(async () => ({ id: "v3", number: 3, label: "Renamed" }));
const mockDeleteVersion = vi.fn(async () => ({ id: "v3", number: 3 }));
vi.mock("@/hooks/use-project-version-writes", () => ({
  useProjectVersionWrites: () => ({
    createVersion: mockCreateVersion,
    makeLive: mockMakeLive,
    setLabel: mockSetLabel,
    deleteVersion: mockDeleteVersion,
  }),
}));

import { VersionsPanel } from "@/components/projects/versions-panel";

const LIVE = { id: "v4", number: 4, isLive: true, contentState: "ready" as const, createdAt: Date.UTC(2026, 6, 19), createdById: "u1" };
const NON_LIVE = { id: "v3", number: 3, label: "With LED wall", isLive: false, contentState: "ready" as const, createdAt: Date.UTC(2026, 6, 15), createdById: "u1" };
const VERSIONS = [LIVE, NON_LIVE];

function renderPanel(overrides: Partial<React.ComponentProps<typeof VersionsPanel>> = {}) {
  const onSwitch = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <VersionsPanel
      open
      onOpenChange={onOpenChange}
      projectId="proj1"
      versions={VERSIONS}
      liveVersion={LIVE}
      viewingNumber={null}
      onSwitch={onSwitch}
      {...overrides}
    />,
  );
  return { ...utils, onSwitch, onOpenChange };
}

describe("VersionsPanel smoke", () => {
  it("opens as a dialog (Sheet) and lists every version", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/v4 · Live/)).toBeTruthy();
    expect(within(dialog).getByText(/v3 · With LED wall/)).toBeTruthy();
  });

  it("clicking a non-live row switches to it; clicking the live row clears the viewed version", () => {
    const { onSwitch } = renderPanel();
    fireEvent.click(screen.getByText(/v3 · With LED wall/));
    expect(onSwitch).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByText(/v4 · Live/));
    expect(onSwitch).toHaveBeenCalledWith(null);
  });

  it("the live row offers only Rename", async () => {
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: /v4 actions/i }), { key: "Enter" });
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByText("Rename")).toBeTruthy();
    expect(menu.queryByText(/make v4 live/i)).toBeNull();
    expect(menu.queryByText(/delete version/i)).toBeNull();
  });

  it("the non-live row offers Make live, Rename and Delete", async () => {
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: /v3 actions/i }), { key: "Enter" });
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByText(/make v3 live/i)).toBeTruthy();
    expect(menu.getByText("Rename")).toBeTruthy();
    expect(menu.getByText(/delete version/i)).toBeTruthy();
  });

  it("New version creates from the viewed (non-live) version and switches to the result", async () => {
    const { onSwitch } = renderPanel({ viewingNumber: 3 });
    fireEvent.click(screen.getByRole("button", { name: /new version from v3/i }));
    await waitFor(() => expect(mockCreateVersion).toHaveBeenCalledWith({ fromVersionId: "v3" }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(5));
  });

  it("renaming a version opens the rename dialog and calls setLabel", async () => {
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: /v3 actions/i }), { key: "Enter" });
    const renameItem = await screen.findByText("Rename");
    fireEvent.click(renameItem);

    const dialog = await screen.findByRole("dialog", { name: /rename v3/i });
    const input = within(dialog).getByPlaceholderText(/e\.g\. with led wall/i);
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save name/i }));
    await waitFor(() => expect(mockSetLabel).toHaveBeenCalledWith("v3", "New name"));
  });

  it("Make live opens the Make-live dialog and, on success with no conflicts, switches back to live", async () => {
    const { onSwitch } = renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: /v3 actions/i }), { key: "Enter" });
    const makeLiveItem = await screen.findByText(/make v3 live/i);
    fireEvent.click(makeLiveItem);

    const dialog = await screen.findByRole("dialog", { name: /make v3 live/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^make v3 live$/i }));
    await waitFor(() => expect(mockMakeLive).toHaveBeenCalledWith("v3"));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(null));
  });

  it("Make live with conflicts lists them and stays open until Done", async () => {
    mockMakeLive.mockResolvedValueOnce({
      liveVersionId: "v3",
      previousLiveVersionId: "v4",
      conflicts: ["Moving the rental window created a shortage of 2 × LED panel."],
      unplannedLineItemIds: [],
    });
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: /v3 actions/i }), { key: "Enter" });
    fireEvent.click(await screen.findByText(/make v3 live/i));
    const dialog = await screen.findByRole("dialog", { name: /make v3 live/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^make v3 live$/i }));

    await waitFor(() => expect(within(dialog).getByText(/1 item needs a look/i)).toBeTruthy());
    expect(within(dialog).getByText(/shortage of 2 × LED panel/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /done/i })).toBeTruthy();
  });

  it("deleting a non-live version opens a confirm dialog and calls deleteVersion", async () => {
    renderPanel();
    fireEvent.keyDown(screen.getByRole("button", { name: /v3 actions/i }), { key: "Enter" });
    fireEvent.click(await screen.findByText(/delete version/i));

    const dialog = await screen.findByRole("dialog", { name: /delete v3/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /delete version/i }));
    await waitFor(() => expect(mockDeleteVersion).toHaveBeenCalledWith("v3"));
  });
});
