// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { playScanFeedback } from "./scan-feedback";

describe("playScanFeedback", () => {
  let started: boolean;
  let stoppedAt: number | undefined;
  let closed: boolean;

  beforeEach(() => {
    started = false;
    stoppedAt = undefined;
    closed = false;

    class FakeOscillator {
      frequency = { value: 0 };
      onended: (() => void) | null = null;
      connect() {}
      start() {
        started = true;
      }
      stop(at: number) {
        stoppedAt = at;
        // Real AudioContext always fires `onended` asynchronously (at a future
        // audio-clock time) — defer here too so the fake doesn't depend on
        // whichever line happens to assign `onended` first.
        queueMicrotask(() => this.onended?.());
      }
    }
    class FakeGain {
      gain = { value: 0 };
      connect() {}
    }
    class FakeAudioContext {
      currentTime = 0;
      createOscillator() {
        return new FakeOscillator();
      }
      createGain() {
        return new FakeGain();
      }
      close() {
        closed = true;
        return Promise.resolve();
      }
    }
    // @ts-expect-error test stub
    window.AudioContext = FakeAudioContext;
  });

  it("plays a success tone without throwing", () => {
    expect(() => playScanFeedback("success")).not.toThrow();
    expect(started).toBe(true);
    expect(stoppedAt).toBeCloseTo(0.15);
  });

  it("plays a distinct error tone", () => {
    playScanFeedback("error");
    expect(stoppedAt).toBeCloseTo(0.4);
  });

  it("plays a distinct exception tone (neither success nor error)", () => {
    playScanFeedback("exception");
    expect(stoppedAt).toBeCloseTo(0.25);
  });

  it("closes the AudioContext once the tone finishes", async () => {
    playScanFeedback("success");
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(true);
  });

  it("never throws when AudioContext is unavailable", () => {
    // @ts-expect-error test stub
    window.AudioContext = undefined;
    expect(() => playScanFeedback("success")).not.toThrow();
  });
});
