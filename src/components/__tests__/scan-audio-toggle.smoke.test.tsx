// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ScanAudioToggle } from "@/components/scan-audio-toggle";
import { useScanFeedback } from "@/hooks/use-scan-feedback";

/**
 * Regression target: the old T&T `playBeep` swallowed every Web Audio failure
 * with a bare `catch {}`, so nothing verified it actually survived running
 * without a real Web Audio API (jsdom has none). This renders the real
 * `useScanFeedback` + `ScanAudioToggle` pair end-to-end — no mocked
 * AudioContext factory — and drives an actual scan-feedback play through the
 * toggle's consumer, confirming the missing-API path never throws or breaks
 * the render tree.
 */
function ScanFeedbackConsumer() {
  const scanFeedback = useScanFeedback();
  return (
    <div>
      <ScanAudioToggle enabled={scanFeedback.enabled} onToggle={scanFeedback.toggle} />
      <button onClick={() => scanFeedback.play("success")}>Simulate scan</button>
    </div>
  );
}

describe("ScanAudioToggle + useScanFeedback smoke", () => {
  it("renders enabled by default with the Volume2 (on) affordance", () => {
    render(<ScanFeedbackConsumer />);
    expect(screen.getByLabelText("Disable audio")).toBeTruthy();
  });

  it("toggling flips the icon/label and playing a tone never throws, even with no real Web Audio API", () => {
    render(<ScanFeedbackConsumer />);

    // Simulate a scan verdict with audio still enabled — jsdom has no
    // AudioContext, so this exercises the real "swallow and continue" path.
    expect(() => fireEvent.click(screen.getByText("Simulate scan"))).not.toThrow();

    fireEvent.click(screen.getByLabelText("Disable audio"));
    expect(screen.getByLabelText("Enable audio")).toBeTruthy();

    // Disabled: play() should short-circuit before ever touching audio.
    expect(() => fireEvent.click(screen.getByText("Simulate scan"))).not.toThrow();
  });
});
