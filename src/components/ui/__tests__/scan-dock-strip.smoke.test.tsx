// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/scanner/camera-scanner-dialog", () => ({
  CameraScannerDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div role="dialog">{title}</div> : null,
}));

import { ScanDock, PREP_SCAN_MODES } from "@/components/ui/scan-dock";
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

describe("ScanDock custom modes", () => {
  it("renders the stage's own verbs and placeholder and reports the chosen value", async () => {
    const onMode = vi.fn();
    render(
      <ScanDock
        onScan={() => {}}
        modes={[{ value: "deploy", label: "Deploy" }, { value: "verify", label: "Verify only" }]}
        mode="deploy"
        onModeChange={onMode}
        placeholder="Scan to deploy…"
      />,
    );
    expect(screen.getByPlaceholderText("Scan to deploy…")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Prep as I scan" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Deploy" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("radio", { name: "Verify only" }));
    expect(onMode).toHaveBeenCalledWith("verify");
  });

  it("defaults to the Prep modes", () => {
    expect(PREP_SCAN_MODES.map((m) => m.label)).toEqual(["Prep as I scan", "Check only"]);
  });
});

describe("ScanDock filter props", () => {
  it("reports every typed change and the clear after submit; exposes the input by ref and id", async () => {
    const onValueChange = vi.fn();
    const onScan = vi.fn();
    const ref = React.createRef<HTMLInputElement>();
    render(
      <ScanDock
        onScan={onScan}
        mode="prep"
        onModeChange={() => {}}
        onValueChange={onValueChange}
        inputRef={ref}
        inputId="q"
      />,
    );
    const input = screen.getByLabelText("Scan input");
    expect(input.id).toBe("q");
    expect(ref.current).toBe(input);
    await userEvent.type(input, "23{Enter}");
    expect(onValueChange.mock.calls.map((c) => c[0])).toEqual(["2", "23", ""]);
    expect(onScan).toHaveBeenCalledWith("23");
  });

  it("works unchanged without the new props", async () => {
    const onScan = vi.fn();
    render(<ScanDock onScan={onScan} mode="prep" onModeChange={() => {}} />);
    const input = screen.getByLabelText("Scan input");
    expect(input.id).toBe("");
    await userEvent.type(input, "X{Enter}");
    expect(onScan).toHaveBeenCalledWith("X");
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

  it("renders an info entry and its trailing controls after the action", async () => {
    const open = vi.fn();
    render(
      <ScanStrip
        entries={[
          {
            id: "1",
            tone: "info",
            text: "SK-0012 · packed for #2341",
            trailing: <button type="button" onClick={open}>Open</button>,
          },
        ]}
      />,
    );
    const row = screen.getByText("SK-0012 · packed for #2341").closest("li");
    expect(row?.getAttribute("data-tone")).toBe("info");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
