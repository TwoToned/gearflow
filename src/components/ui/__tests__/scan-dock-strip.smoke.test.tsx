// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/scanner/camera-scanner-dialog", () => ({
  CameraScannerDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div role="dialog">{title}</div> : null,
}));

import { ScanDock } from "@/components/ui/scan-dock";
import { ScanStrip, type ScanStripEntry } from "@/components/ui/scan-strip";

describe("ScanDock", () => {
  it("Enter submits the typed tag once and clears; camera opens from the click", async () => {
    const onScan = vi.fn();
    render(<ScanDock onScan={onScan} mode="prep" onModeChange={() => {}} />);
    const input = screen.getByLabelText("Scan input");
    await userEvent.type(input, "AB-123{Enter}");
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("AB-123");
    expect((input as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Scan with camera" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("shows the target menu and the two mode words", async () => {
    const onChange = vi.fn();
    const onMode = vi.fn();
    render(
      <ScanDock
        onScan={() => {}}
        mode="prep"
        onModeChange={onMode}
        target={{
          verb: "Packing into",
          current: { id: "a", label: "LX-04" },
          options: [{ id: "a", label: "LX-04" }, { id: "b", label: "LX-05" }],
          onChange,
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Packing into LX-04/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "LX-05" }));
    expect(onChange).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByRole("radio", { name: "Check only" }));
    expect(onMode).toHaveBeenCalledWith("check");
  });
});

describe("ScanStrip", () => {
  it("Undo calls the passed closure exactly once", async () => {
    const undo = vi.fn();
    const entries: ScanStripEntry[] = [{ id: "1", tone: "success", text: "Packed LX-04-A", undo }];
    render(<ScanStrip entries={entries} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("renders every tone with its action and no Undo when not reversible", async () => {
    const run = vi.fn();
    const add = vi.fn();
    render(
      <ScanStrip
        entries={[
          { id: "1", tone: "warning", text: "Needs a check", action: { label: "Run check", onSelect: run } },
          { id: "2", tone: "error", text: "Not on this job", action: { label: "Add & prep", onSelect: add } },
          { id: "3", tone: "neutral", text: "Saved on device · syncing" },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Run check" }));
    await userEvent.click(screen.getByRole("button", { name: "Add & prep" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved on device · syncing")).toBeTruthy();
  });
});
