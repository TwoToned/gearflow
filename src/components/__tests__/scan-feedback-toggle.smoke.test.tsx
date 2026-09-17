// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ScanFeedbackToggle } from "@/components/scan-feedback-toggle";
import { useScanFeedback } from "@/hooks/use-scan-feedback";

/**
 * Regression target: the old T&T `playBeep` swallowed every Web Audio failure
 * with a bare `catch {}`, so nothing verified it actually survived running
 * without a real Web Audio API (jsdom has none). This renders the real
 * `useScanFeedback` + `ScanFeedbackToggle` pair end-to-end — no mocked
 * AudioContext factory, no stubbed `navigator.vibrate` — and drives an actual
 * scan-feedback play through the toggle's consumer, confirming the missing-API
 * paths (audio and haptics both) never throw or break the render tree.
 */
function ScanFeedbackConsumer() {
  const scanFeedback = useScanFeedback();
  return (
    <div>
      <ScanFeedbackToggle enabled={scanFeedback.enabled} onToggle={scanFeedback.toggle} />
      <button onClick={() => scanFeedback.play("success")}>Simulate scan</button>
    </div>
  );
}

describe("ScanFeedbackToggle + useScanFeedback smoke", () => {
  it("renders enabled by default with the Volume2 (on) affordance", () => {
    render(<ScanFeedbackConsumer />);
    expect(screen.getByLabelText("Disable feedback")).toBeTruthy();
  });

  it("toggling flips the icon/label and playing never throws, even with no real Web Audio API or navigator.vibrate", () => {
    render(<ScanFeedbackConsumer />);

    // Simulate a scan verdict with feedback still enabled — jsdom has no
    // AudioContext or navigator.vibrate, so this exercises the real
    // "swallow and continue" path for both.
    expect(() => fireEvent.click(screen.getByText("Simulate scan"))).not.toThrow();

    fireEvent.click(screen.getByLabelText("Disable feedback"));
    expect(screen.getByLabelText("Scan feedback")).toBeTruthy();

    // Disabled: play() should short-circuit before ever touching audio/haptics.
    expect(() => fireEvent.click(screen.getByText("Simulate scan"))).not.toThrow();
  });
});
