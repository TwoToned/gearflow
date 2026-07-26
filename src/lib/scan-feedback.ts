/**
 * Pure, client-only audio feedback for scan verdicts — barcode/tag scanning
 * across Warehouse prep/deploy/return, the T&T quick-test wizard, and the
 * `/check/[assetTag]` ad-hoc station. See FEATUREDOCS/12 (Scan Feedback) and
 * FEATUREDOCS/14 (Audio note).
 *
 * Replaces the old per-call-site `playBeep` (T&T quick-test) which created a
 * brand-new `AudioContext` on every beep and never closed it — Chrome caps
 * concurrent contexts at ~6, so head-down scanning eventually went silent.
 * This module keeps a single **lazy, module-level shared `AudioContext`**,
 * calls `resume()` before every play (browsers auto-suspend contexts created
 * outside a user gesture — the old code never resumed, so beeps could be
 * silently dropped), and ramps gain out instead of hard-stopping (no click).
 */

export type ScanFeedbackKind = "success" | "error" | "exception" | "info";

interface TonePlan {
  /** Oscillator frequency in Hz. */
  frequency: number;
  /** Blip duration in ms. */
  durationMs: number;
  /** Gap before a second blip, in ms. Omitted = single blip. */
  secondBlipGapMs?: number;
}

/**
 * Tone vocabulary (spec decision, 4 kinds):
 * - `success`   — clean scan resolved as expected (800 Hz / 150 ms — byte-identical
 *                 to the old T&T "pass" beep).
 * - `error`     — hard failure, scan rejected (300 Hz / 400 ms — byte-identical to
 *                 the old T&T "fail" beep).
 * - `exception` — resolved but needs attention: not a clean success, not a hard
 *                 error (e.g. already-returned asset, unknown tag, disambiguation
 *                 needed — "scan the parent instead"). 500 Hz double-blip.
 * - `info`      — neutral heads-up, e.g. a quantity prompt opening (600 Hz / 80 ms).
 */
export const SCAN_FEEDBACK_TONES: Record<ScanFeedbackKind, TonePlan> = {
  success: { frequency: 800, durationMs: 150 },
  error: { frequency: 300, durationMs: 400 },
  exception: { frequency: 500, durationMs: 120, secondBlipGapMs: 90 },
  info: { frequency: 600, durationMs: 80 },
};

const GAIN = 0.1;
/** Ramp-out window at the tail of each blip, so the stop doesn't click. */
const RAMP_OUT_MS = 15;

export type AudioContextFactory = () => AudioContext;

function defaultAudioContextFactory(): AudioContext {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API unavailable");
  return new Ctor();
}

let contextFactory: AudioContextFactory = defaultAudioContextFactory;
let sharedContext: AudioContext | null = null;

/**
 * Inject a fake `AudioContext` factory for tests (jsdom has no Web Audio API).
 * Pass `null` to restore the real browser factory. Also used by the T&T page's
 * legacy tests if they construct their own fake — see `scan-feedback.test.ts`.
 */
export function setScanFeedbackContextFactory(factory: AudioContextFactory | null): void {
  contextFactory = factory ?? defaultAudioContextFactory;
  sharedContext = null;
}

function getSharedContext(): AudioContext | null {
  try {
    if (!sharedContext || sharedContext.state === "closed") {
      sharedContext = contextFactory();
    }
    return sharedContext;
  } catch {
    return null;
  }
}

function playBlip(ctx: AudioContext, plan: TonePlan, startAt: number): number {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = plan.frequency;

  const durationS = plan.durationMs / 1000;
  const rampOutS = Math.min(RAMP_OUT_MS / 1000, durationS / 2);
  const rampStart = startAt + durationS - rampOutS;

  gain.gain.setValueAtTime(GAIN, startAt);
  gain.gain.setValueAtTime(GAIN, rampStart);
  gain.gain.linearRampToValueAtTime(0, startAt + durationS);

  osc.start(startAt);
  osc.stop(startAt + durationS);

  return startAt + durationS;
}

/**
 * Play a scan feedback tone. Safe to call unconditionally — any Web Audio
 * failure (autoplay policy, missing API, closed context) is swallowed so
 * callers never need their own try/catch.
 */
export function playScanFeedback(kind: ScanFeedbackKind): void {
  const ctx = getSharedContext();
  if (!ctx) return;
  try {
    void ctx.resume();
    const plan = SCAN_FEEDBACK_TONES[kind];
    const firstBlipEnd = playBlip(ctx, plan, ctx.currentTime);
    if (plan.secondBlipGapMs != null) {
      playBlip(ctx, plan, firstBlipEnd + plan.secondBlipGapMs / 1000);
    }
  } catch {
    // Audio is a non-critical enhancement — never let it break a scan flow.
  }
}
