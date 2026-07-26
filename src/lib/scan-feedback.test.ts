// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  playScanFeedback,
  setScanFeedbackContextFactory,
  SCAN_FEEDBACK_TONES,
  type AudioContextFactory,
} from "@/lib/scan-feedback";

/**
 * jsdom has no Web Audio API, so every test here injects a fake `AudioContext`
 * via `setScanFeedbackContextFactory` — the exact seam the spec calls for
 * ("injectable context factory for tests ... no more blind catch").
 */

interface FakeOscillator {
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

function createFakeAudioContext() {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const resume = vi.fn().mockResolvedValue(undefined);

  const ctx = {
    state: "suspended" as AudioContextState,
    currentTime: 0,
    destination: {},
    resume,
    createOscillator: vi.fn((): FakeOscillator => {
      const osc: FakeOscillator = {
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn((): FakeGain => {
      const gain: FakeGain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };

  return { ctx: ctx as unknown as AudioContext, oscillators, gains, resume };
}

describe("playScanFeedback", () => {
  afterEach(() => {
    setScanFeedbackContextFactory(null);
  });

  it("lazily creates a single shared AudioContext reused across N plays", () => {
    const fake = createFakeAudioContext();
    let calls = 0;
    const factory: AudioContextFactory = () => {
      calls += 1;
      return fake.ctx;
    };
    setScanFeedbackContextFactory(factory);

    playScanFeedback("success");
    playScanFeedback("error");
    playScanFeedback("success");

    expect(calls).toBe(1);
  });

  it("calls resume() before every play", () => {
    const fake = createFakeAudioContext();
    setScanFeedbackContextFactory(() => fake.ctx);

    playScanFeedback("success");
    playScanFeedback("success");
    playScanFeedback("info");

    expect(fake.resume).toHaveBeenCalledTimes(3);
  });

  it("plays success at 800Hz / 150ms — byte-identical to the legacy T&T beep", () => {
    const fake = createFakeAudioContext();
    setScanFeedbackContextFactory(() => fake.ctx);

    playScanFeedback("success");

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.oscillators[0].frequency.value).toBe(800);
    expect(fake.oscillators[0].stop).toHaveBeenCalledWith(0.15);
    expect(SCAN_FEEDBACK_TONES.success).toEqual({ frequency: 800, durationMs: 150 });
  });

  it("plays error at 300Hz / 400ms — byte-identical to the legacy T&T beep", () => {
    const fake = createFakeAudioContext();
    setScanFeedbackContextFactory(() => fake.ctx);

    playScanFeedback("error");

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.oscillators[0].frequency.value).toBe(300);
    expect(fake.oscillators[0].stop).toHaveBeenCalledWith(0.4);
    expect(SCAN_FEEDBACK_TONES.error).toEqual({ frequency: 300, durationMs: 400 });
  });

  it("plays info at 600Hz / 80ms as a single blip", () => {
    const fake = createFakeAudioContext();
    setScanFeedbackContextFactory(() => fake.ctx);

    playScanFeedback("info");

    expect(fake.oscillators).toHaveLength(1);
    expect(fake.oscillators[0].frequency.value).toBe(600);
    expect(fake.oscillators[0].stop).toHaveBeenCalledWith(0.08);
  });

  it("plays exception as a 500Hz double-blip, second blip after the first ends", () => {
    const fake = createFakeAudioContext();
    setScanFeedbackContextFactory(() => fake.ctx);

    playScanFeedback("exception");

    expect(fake.oscillators).toHaveLength(2);
    expect(fake.oscillators[0].frequency.value).toBe(500);
    expect(fake.oscillators[1].frequency.value).toBe(500);

    const firstStart = fake.oscillators[0].start.mock.calls[0][0] as number;
    const firstStop = fake.oscillators[0].stop.mock.calls[0][0] as number;
    const secondStart = fake.oscillators[1].start.mock.calls[0][0] as number;

    expect(firstStart).toBe(0);
    expect(firstStop).toBeCloseTo(0.12, 5);
    // Second blip starts strictly after the first ends (gap, not overlap).
    expect(secondStart).toBeGreaterThan(firstStop);
    expect(secondStart).toBeCloseTo(firstStop + 0.09, 5);
  });

  it("ramps gain out instead of a hard stop (no click)", () => {
    const fake = createFakeAudioContext();
    setScanFeedbackContextFactory(() => fake.ctx);

    playScanFeedback("success");

    const gain = fake.gains[0].gain;
    expect(gain.setValueAtTime).toHaveBeenCalled();
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.15);
  });

  it("swallows AudioContext construction failures instead of throwing", () => {
    setScanFeedbackContextFactory(() => {
      throw new Error("Web Audio unavailable");
    });

    expect(() => playScanFeedback("success")).not.toThrow();
  });

  it("swallows failures from a context that throws mid-play", () => {
    const fake = createFakeAudioContext();
    fake.ctx.createOscillator = vi.fn(() => {
      throw new Error("boom");
    });
    setScanFeedbackContextFactory(() => fake.ctx);

    expect(() => playScanFeedback("success")).not.toThrow();
  });

  it("re-creates the context if the shared one was closed", () => {
    const fakeA = createFakeAudioContext();
    (fakeA.ctx as unknown as { state: AudioContextState }).state = "closed";
    let created = 0;
    const fakeB = createFakeAudioContext();
    setScanFeedbackContextFactory(() => {
      created += 1;
      return created === 1 ? fakeA.ctx : fakeB.ctx;
    });

    playScanFeedback("success");
    playScanFeedback("success");

    expect(created).toBe(2);
  });
});
