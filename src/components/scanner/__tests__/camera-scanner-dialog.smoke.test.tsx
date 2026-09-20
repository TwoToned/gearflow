// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // jsdom has no media pipeline: its `play()` is a stub that logs "Not
  // implemented" and rejects. Replace it outright (not `??=`) so the noise
  // stays out of the run — the hook deliberately swallows a play() rejection,
  // which is covered by the tests below reaching the "Searching…" state.
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  // jsdom has no matchMedia, which `useIsMobile` calls on mount.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

// The decoder is a 930 KiB WASM download — never instantiated in jsdom. The
// pixel-level proof that it decodes lives in `src/lib/barcode/decoder.test.ts`;
// what THIS file proves is that the dialog reaches the right states and,
// critically, always releases the camera.
vi.mock("@/lib/barcode/decoder", () => ({
  loadDecoder: () => Promise.resolve({}),
  decodeImageData: () => Promise.resolve([]),
}));

import { CameraScannerDialog } from "../camera-scanner-dialog";

const stopTrack = vi.fn();

function installCamera(getUserMedia: (constraints?: MediaStreamConstraints) => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function fakeStream(): MediaStream {
  const track = { stop: stopTrack, getCapabilities: () => ({}) } as unknown as MediaStreamTrack;
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

function rejectWith(name: string) {
  return () => Promise.reject(Object.assign(new Error(name), { name }));
}

beforeEach(() => {
  stopTrack.mockClear();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CameraScannerDialog", () => {
  it("renders the heading and tells the operator which codes work", async () => {
    installCamera(() => Promise.resolve(fakeStream()));
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} title="Scan asset tag" />);

    expect(await screen.findByText("Scan asset tag")).toBeTruthy();
    // Micro QR / rMQR are the reason this feature exists — if the copy stops
    // naming them, operators won't know to try.
    expect(screen.getByText(/Micro QR/)).toBeTruthy();
    expect(screen.getByText(/rMQR/)).toBeTruthy();
  });

  it("requests the camera when opened", async () => {
    const getUserMedia = vi.fn((_constraints?: MediaStreamConstraints) => Promise.resolve(fakeStream()));
    installCamera(getUserMedia);
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    // `ideal`, never `exact` — `exact` OverconstrainedErrors on any device
    // without a rear camera.
    const constraints = getUserMedia.mock.calls[0]?.[0];
    expect((constraints?.video as MediaTrackConstraints).facingMode).toEqual({ ideal: "environment" });
  });

  it("does NOT request the camera while closed", async () => {
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    installCamera(getUserMedia);
    render(<CameraScannerDialog open={false} onOpenChange={() => {}} onScan={() => {}} />);

    await new Promise((r) => setTimeout(r, 10));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("releases the camera when it closes — a leaked iOS track blocks the next open app-wide", async () => {
    installCamera(() => Promise.resolve(fakeStream()));
    const { rerender } = render(
      <CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />,
    );
    await waitFor(() => expect(stopTrack).not.toHaveBeenCalled());

    rerender(<CameraScannerDialog open={false} onOpenChange={() => {}} onScan={() => {}} />);
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("releases the camera on unmount", async () => {
    installCamera(() => Promise.resolve(fakeStream()));
    const { unmount } = render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);
    await waitFor(() => expect(stopTrack).not.toHaveBeenCalled());

    unmount();
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("shows recoverable instructions when permission is denied", async () => {
    installCamera(rejectWith("NotAllowedError"));
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);

    // An installed iOS PWA can lose a previously-granted permission between
    // launches, so a denial must offer a way back rather than a black rectangle.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Settings/);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("explains an insecure origin instead of opening a dead viewport", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    installCamera(() => Promise.resolve(fakeStream()));
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/HTTPS/);
  });

  it("explains a camera already in use", async () => {
    installCamera(rejectWith("NotReadableError"));
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/another app or tab/i);
  });

  it("hides the torch button when the track advertises no torch — the iOS case", async () => {
    installCamera(() => Promise.resolve(fakeStream()));
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Searching for a code/)).toBeTruthy());
    // A dead torch button is worse than no torch button.
    expect(screen.queryByRole("button", { name: /torch/i })).toBeNull();
  });

  it("shows the torch button when the track advertises one", async () => {
    const track = {
      stop: stopTrack,
      getCapabilities: () => ({ torch: true }),
      applyConstraints: () => Promise.resolve(),
    } as unknown as MediaStreamTrack;
    installCamera(() =>
      Promise.resolve({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream),
    );
    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);

    expect(await screen.findByRole("button", { name: /turn torch on/i })).toBeTruthy();
  });

  it("releases the camera when the app is backgrounded, and re-acquires on return", async () => {
    // iOS suspends capture when the app goes to the background and never
    // resumes it, so holding the track means a permanently black viewport.
    // Releasing is only half of it — coming back has to re-acquire, or the
    // scanner is dead for the rest of the session.
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    installCamera(getUserMedia);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");

    render(<CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

    visibility.mockRestore();
  });

  it("does NOT re-acquire on return once the dialog has closed", async () => {
    // The counterpart: re-acquiring must be gated on the consumer still wanting
    // a camera, or backgrounding the app would light it up behind a dismissed
    // dialog.
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    installCamera(getUserMedia);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");

    const { rerender } = render(
      <CameraScannerDialog open onOpenChange={() => {}} onScan={() => {}} />,
    );
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

    rerender(<CameraScannerDialog open={false} onOpenChange={() => {}} onScan={() => {}} />);
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());

    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 20));
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    visibility.mockRestore();
  });

  it("closes on Done", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    installCamera(() => Promise.resolve(fakeStream()));
    render(<CameraScannerDialog open onOpenChange={onOpenChange} onScan={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
