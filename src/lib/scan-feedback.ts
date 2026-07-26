/**
 * Minimal scan-feedback audio helper (issue #944 WS5).
 *
 * The WS5 spec calls for consuming a "QW-1 shared beep" helper from the sibling
 * quick-wins tracking issue (#937), which other sessions were working on
 * concurrently and had not landed at the time this was built. Per the issue's own
 * instruction, this is a minimal LOCAL success/error/exception tone helper (Web
 * Audio API), following the one existing scan-feedback precedent in this codebase
 * — `playBeep()` in `src/app/(app)/test-and-tag/quick-test/page.tsx` (success vs.
 * failure tone, try/catch-swallowed `AudioContext`) — extended from a binary
 * success/fail to the three outcomes the returns station actually has (a
 * successful return, a hard error, and a session-local exception that still
 * doesn't block the dock).
 *
 * ⚠️ CONSOLIDATION TODO: once #937's `useScanFeedback` (or equivalent) lands,
 * replace this file's usage with it and delete this file — don't let two beep
 * helpers coexist long-term (POLICY.md R-3.1 single source of truth).
 */

export type ScanFeedbackTone = "success" | "error" | "exception";

const TONE: Record<ScanFeedbackTone, { frequency: number; durationSec: number }> = {
  // A clean high beep for "returned, moving on" — mirrors quick-test's success tone.
  success: { frequency: 800, durationSec: 0.15 },
  // A low buzz for "hard failure, nothing happened" — mirrors quick-test's fail tone.
  error: { frequency: 300, durationSec: 0.4 },
  // A distinct mid double-purpose tone for "logged as an exception, dock keeps
  // moving" — deliberately NOT the same as either success or error, since an
  // exception is neither: it's a resolvable identity with no active return to
  // make (retired / no active deployment / disambiguation needed), and it must
  // read as "noted, not blocking" rather than "something broke".
  exception: { frequency: 550, durationSec: 0.25 },
};

/**
 * Play a short tone for the given scan outcome. Best-effort: swallows any
 * failure (no AudioContext support, autoplay policy, etc.) — a missing beep must
 * never block or interrupt the scan flow itself.
 */
export function playScanFeedback(tone: ScanFeedbackTone): void {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const { frequency, durationSec } = TONE[tone];
    osc.frequency.value = frequency;
    gain.gain.value = 0.1;
    // Release the context once the tone finishes — AudioContext instances aren't
    // free and quick-test's precedent never closes them; a returns-station batch
    // scan session can fire many more tones per minute than a single T&T test, so
    // close explicitly to avoid accumulating contexts. Assigned before `.stop()`
    // is called (not that it matters for a real AudioContext — `onended` always
    // fires at a future audio-clock time — but it's the conventional order).
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  } catch {
    /* ignore if audio not available */
  }
}
