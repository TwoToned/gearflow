// @vitest-environment jsdom
import React, { useState } from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

vi.mock("@/lib/barcode/decoder", () => ({
  loadDecoder: () => Promise.resolve({}),
  decodeImageData: () => Promise.resolve([]),
}));

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AssetTagInput } from "@/components/ui/asset-tag-input";

const stopTrack = vi.fn();

function fakeStream(): MediaStream {
  const track = { stop: stopTrack, getCapabilities: () => ({}) } as unknown as MediaStreamTrack;
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

beforeEach(() => {
  stopTrack.mockClear();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(fakeStream()) },
  });
});

afterEach(() => cleanup());

/**
 * Stand-in for the warehouse "Assign assets" dialog: a Radix modal Dialog that
 * contains an `AssetTagInput`, whose camera button opens ANOTHER Radix modal
 * Dialog on top of it.
 */
function AssignAssetsHarness({ onScan }: { onScan: (v: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign assets</DialogTitle>
        </DialogHeader>
        <AssetTagInput onScan={onScan} scannerTitle="Scan to assign" continuous placeholder="Scan an asset tag..." />
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </DialogContent>
    </Dialog>
  );
}

describe("camera scanner nested inside a Radix modal Dialog", () => {
  it("opens over the host dialog without unmounting it", async () => {
    const user = userEvent.setup();
    render(<AssignAssetsHarness onScan={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Scan to assign" }));

    // Both dialogs live at once — the host must not be torn down underneath.
    expect(await screen.findByText("Scan to assign")).toBeTruthy();
    expect(screen.getByText("Assign assets")).toBeTruthy();
  });

  it("leaves the host dialog INTERACTIVE after the scanner closes", async () => {
    // The failure this guards against is the one CLAUDE.md calls out: an
    // overlay that leaves `pointer-events: none` on <body> when it unmounts,
    // so the page underneath looks fine and silently swallows every click.
    const user = userEvent.setup();
    const onCancel = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign assets</DialogTitle></DialogHeader>
            <AssetTagInput onScan={() => {}} scannerTitle="Scan to assign" continuous />
            <Button onClick={onCancel}>Cancel</Button>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Scan to assign" }));
    await screen.findByText("Scan to assign");

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("Scan to assign")).toBeNull());

    // The host dialog's own button must still respond.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("releases the camera when the scanner closes but the host stays open", async () => {
    // One live capture at a time on iOS — a track leaked here would block the
    // NEXT getUserMedia anywhere in the app, including reopening this scanner.
    const user = userEvent.setup();
    render(<AssignAssetsHarness onScan={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Scan to assign" }));
    await screen.findByText("Scan to assign");

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
    // Host is still up.
    expect(screen.getByText("Assign assets")).toBeTruthy();
  });

  it("releases the camera if the HOST is torn down mid-scan", async () => {
    // Navigating away (or the host dialog unmounting) takes the scanner with it
    // without it ever seeing its own close, so the hook's unmount teardown is
    // the only thing that stops the camera. A leaked track blocks the next
    // getUserMedia app-wide on iOS.
    const user = userEvent.setup();
    const { unmount } = render(<AssignAssetsHarness onScan={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Scan to assign" }));
    await screen.findByText("Scan to assign");
    expect(stopTrack).not.toHaveBeenCalled();

    unmount();
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("keeps the host dialog inert while the scanner is open", async () => {
    // Radix stacks the layers, so the host's controls leave the a11y tree while
    // the scanner is on top. That is the CORRECT behaviour — it is what stops a
    // stray tap landing on "Cancel" behind a full-screen camera — and asserting
    // it here stops a future change from silently making the host clickable
    // underneath the viewport.
    const user = userEvent.setup();
    render(<AssignAssetsHarness onScan={() => {}} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Scan to assign" }));
    await screen.findByText("Scan to assign");

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("delivers a scanned value to the host's handler", async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    render(<AssignAssetsHarness onScan={onScan} />);

    // Typing + Enter is the HID-wedge path; it must reach the same handler the
    // camera does, from inside the nested-dialog host.
    const field = screen.getByPlaceholderText("Scan an asset tag...");
    await user.type(field, "HS-001");
    expect((field as HTMLInputElement).value).toBe("HS-001");

    await user.click(screen.getByRole("button", { name: "Scan to assign" }));
    expect(await screen.findByText("Scan to assign")).toBeTruthy();
  });
});
