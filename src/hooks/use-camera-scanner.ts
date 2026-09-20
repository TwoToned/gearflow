"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildVideoConstraints,
  classifyCameraError,
  computeRoi,
  detectCameraBlocker,
  stopStream,
  summariseTrackCapabilities,
  type CameraError,
  type TrackCapabilitySummary,
} from "@/lib/barcode/camera";
import { decodeImageData, loadDecoder } from "@/lib/barcode/decoder";
import { formatLabel, normaliseScannedValue } from "@/lib/barcode/formats";

/**
 * Camera lifecycle + decode pump for the in-app barcode scanner.
 *
 * Read `src/lib/barcode/camera.ts`'s header first — it carries the platform
 * brief this hook implements. The rules that live HERE, because they are about
 * sequencing rather than values:
 *
 * 1. **`getUserMedia` only ever runs inside a user gesture.** `start()` is
 *    called from the dialog's open handler, never from an effect on mount.
 *    Safari rejects a permission prompt that is not gesture-attributed, and the
 *    rejection looks identical to a denial.
 * 2. **`play()` is awaited and its rejection swallowed.** iOS needs
 *    `playsInline` + `muted` + `autoplay` on the element AND an explicit
 *    `play()`; without it the stream is live but the element paints black.
 *    `play()` also rejects benignly when the dialog closes mid-start.
 * 3. **Dimensions come from `videoWidth`/`videoHeight`, and we wait for them.**
 *    They are 0 until `loadedmetadata`, and an ROI computed off 0 silently
 *    decodes an empty canvas forever — a scanner that looks alive and never
 *    reads anything, which is precisely how the last one failed.
 * 4. **Frames are pumped by `requestVideoFrameCallback` where available**
 *    (Safari 15.4+, Chrome Android), falling back to `setTimeout`. `rVFC` fires
 *    on real camera frames, so we never decode the same frame twice; plain
 *    `requestAnimationFrame` both over-fires (60 Hz against a 30 fps camera)
 *    and stops entirely when the tab is hidden.
 * 5. **The stream is released on hide and re-acquired on show.** iOS suspends
 *    the capture when the app is backgrounded and does NOT resume it — the
 *    element comes back permanently black. Holding a dead track is worse than
 *    re-prompting.
 */

/** Target decode rate. 8/s is well inside a phone's budget and beyond human aim speed. */
const DECODE_INTERVAL_MS = 125;

/** Fallback pump interval when `requestVideoFrameCallback` is unavailable. */
const FALLBACK_FRAME_MS = 100;

/** Ignore a repeat of the same value inside this window (one label, many frames). */
const DUPLICATE_WINDOW_MS = 1500;

export type ScannerStatus = "idle" | "starting" | "loading-decoder" | "scanning" | "error";

export interface ScanResult {
  /** The decoded value, normalised and validated against the tag grammar. */
  value: string;
  /** Human label for the symbology, e.g. "Micro QR". */
  format: string;
}

interface UseCameraScannerOptions {
  /** Fired once per accepted decode. Must be stable or cheap — it is called from the pump. */
  onResult: (result: ScanResult) => void;
  /**
   * Keep scanning after a hit (warehouse batch scanning) rather than stopping.
   * Duplicate suppression still applies, so holding one label steady fires once.
   */
  continuous?: boolean;
}

interface UseCameraScanner {
  status: ScannerStatus;
  error: CameraError | null;
  capabilities: TrackCapabilitySummary;
  torchOn: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
  toggleTorch: () => Promise<void>;
}

/** The subset of ZXing's `ReadResult` the pump consumes. */
interface DecodedFrameResult {
  isValid: boolean;
  text: string;
  format: string;
}

/** `requestVideoFrameCallback` is not in lib.dom for every TS version we build against. */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function useCameraScanner({ onResult, continuous = false }: UseCameraScannerOptions): UseCameraScanner {
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);
  const [capabilities, setCapabilities] = useState<TrackCapabilitySummary>({ torch: false, zoom: false });
  const [torchOn, setTorchOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Guards the pump against overlapping decodes and against running after stop(). */
  const runningRef = useRef(false);
  const decodingRef = useRef(false);
  const lastDecodeAtRef = useRef(0);
  const lastHitRef = useRef<{ value: string; at: number } | null>(null);
  const frameHandleRef = useRef<number | null>(null);
  const timeoutHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when `start()` is in flight, so a `stop()` that races it wins. */
  const generationRef = useRef(0);
  /**
   * Whether the CONSUMER still wants a camera. Distinguishes a backgrounding
   * suspend (release the hardware, but come back) from a real stop (the dialog
   * closed), which is what makes rule 5's "re-acquire on show" possible without
   * re-opening the camera behind a dismissed dialog.
   */
  const wantsCameraRef = useRef(false);

  // `onResult` / `continuous` are read from refs so the pump closure never goes
  // stale and the caller doesn't have to memoise a handler to avoid restarting
  // the camera. Written in an effect, not during render — assigning a ref during
  // render is a purity violation React 19 flags, and it would also mean a
  // discarded render could publish a handler that never committed.
  const onResultRef = useRef(onResult);
  const continuousRef = useRef(continuous);
  useEffect(() => {
    onResultRef.current = onResult;
    continuousRef.current = continuous;
  });

  const cancelPump = useCallback(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    if (frameHandleRef.current !== null) {
      video?.cancelVideoFrameCallback?.(frameHandleRef.current);
      frameHandleRef.current = null;
    }
    if (timeoutHandleRef.current !== null) {
      clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }
  }, []);

  /** Release the hardware without giving up on wanting it. */
  const release = useCallback(() => {
    generationRef.current += 1;
    runningRef.current = false;
    cancelPump();
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      // Clearing srcObject is what actually releases the camera indicator on
      // iOS; stopping the tracks alone can leave the element holding a
      // reference and the green dot lit.
      video.srcObject = null;
    }
    setTorchOn(false);
    setCapabilities({ torch: false, zoom: false });
    setStatus((current) => (current === "error" ? current : "idle"));
  }, [cancelPump]);

  const stop = useCallback(() => {
    wantsCameraRef.current = false;
    release();
  }, [release]);

  /** Grab the current frame's ROI as ImageData, or null if the frame isn't ready. */
  const grabRoi = useCallback((): ImageData | null => {
    const video = videoRef.current;
    if (!video) return null;
    const { videoWidth, videoHeight } = video;
    // Rule 3: dimensions are 0 until metadata lands. Bail, don't decode nothing.
    if (!videoWidth || !videoHeight) return null;

    const roi = computeRoi(videoWidth, videoHeight);
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    if (canvas.width !== roi.sWidth || canvas.height !== roi.sHeight) {
      canvas.width = roi.sWidth;
      canvas.height = roi.sHeight;
    }
    // `willReadFrequently` matters: without it Chrome promotes the canvas to the
    // GPU and every `getImageData` becomes a readback stall.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(video, roi.sx, roi.sy, roi.sWidth, roi.sHeight, 0, 0, roi.sWidth, roi.sHeight);
      return ctx.getImageData(0, 0, roi.sWidth, roi.sHeight);
    } catch {
      // drawImage throws while the element is between streams (the hide/show
      // cycle in rule 5). Skipping this frame is the whole recovery.
      return null;
    }
  }, []);

  /**
   * Publish the first decode in a frame that is usable, if any.
   *
   * "Usable" drops three things silently rather than surfacing them: an invalid
   * or empty read; anything outside the tag grammar (pointing a camera at a
   * warehouse incidentally reads shipping labels and product EANs, and beeping
   * at each one is noise); and a repeat of the value we just took, since one
   * label sits in front of the lens for many frames.
   *
   * Returns true if a result was published.
   */
  const publishFirstUsable = useCallback((results: readonly DecodedFrameResult[], now: number): boolean => {
    for (const result of results) {
      if (!result.isValid || !result.text) continue;
      const value = normaliseScannedValue(result.text);
      if (!value) continue;

      const last = lastHitRef.current;
      if (last && last.value === value && now - last.at < DUPLICATE_WINDOW_MS) continue;

      lastHitRef.current = { value, at: now };
      onResultRef.current({ value, format: formatLabel(result.format) });
      return true;
    }
    return false;
  }, []);

  const tick = useCallback(async () => {
    if (!runningRef.current) return;
    const now = Date.now();
    // Throttle: rVFC delivers 30–60 frames/s; we only want 8 decodes/s.
    if (decodingRef.current || now - lastDecodeAtRef.current < DECODE_INTERVAL_MS) return;

    const image = grabRoi();
    if (!image) return;

    decodingRef.current = true;
    lastDecodeAtRef.current = now;
    try {
      const results = await decodeImageData(image);
      if (!runningRef.current) return;
      if (publishFirstUsable(results, now) && !continuousRef.current) stop();
    } catch {
      // A decode failure is a frame-level event (a torn frame, a wasm hiccup).
      // The next tick is 125 ms away; killing the session over one is wrong.
    } finally {
      decodingRef.current = false;
    }
  }, [grabRoi, publishFirstUsable, stop]);

  // `tick` is reached through a ref so the scheduler below can stay identity-
  // stable: if rescheduling depended on `tick`, every re-render would build a
  // new `start`, and the effect that calls it would restart the camera.
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  /**
   * Rule 4: prefer real camera frames; fall back to a timer.
   *
   * A NAMED function expression, so the loop can reschedule via `schedule`
   * without referencing the outer `const` before it is initialised.
   */
  const schedulePump = useCallback(function schedule() {
    if (!runningRef.current) return;
    const video = videoRef.current as VideoWithFrameCallback | null;
    const loop = () => {
      if (!runningRef.current) return;
      void tickRef.current().finally(() => schedule());
    };
    if (video?.requestVideoFrameCallback) {
      frameHandleRef.current = video.requestVideoFrameCallback(loop);
    } else {
      timeoutHandleRef.current = setTimeout(loop, FALLBACK_FRAME_MS);
    }
  }, []);

  /**
   * Point the `<video>` at the stream and get it painting.
   *
   * Rule 2 lives here: `muted` + `playsInline` + an explicit awaited `play()`
   * are ALL required on iOS. Setting the properties here as well as in JSX
   * matters because the element is reused across opens, and a property set by
   * React on first mount is not re-applied on the second.
   *
   * Returns false when there is no element to attach to.
   */
  const attachStream = useCallback(async (stream: MediaStream): Promise<boolean> => {
    const video = videoRef.current;
    if (!video) return false;

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      // Rejects when the dialog closes mid-start, and (harmlessly) on some
      // engines when play() is called while the element is already playing.
    }
    return true;
  }, []);

  /**
   * Open the camera, or report why it could not open.
   *
   * Split out of `start` because a rejection here is the single most common
   * outcome in the field (a denial, a busy device) and it deserves to be read
   * as its own step rather than buried in the happy path. Returns null once the
   * error state is set — or silently, if a `stop()` raced us, since surfacing
   * an error for a dialog the user already closed is noise.
   */
  const acquireStream = useCallback(async (isStale: () => boolean): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia(buildVideoConstraints());
    } catch (cause) {
      if (isStale()) return null;
      setError(classifyCameraError(cause));
      setStatus("error");
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    wantsCameraRef.current = true;
    const blocker = detectCameraBlocker();
    if (blocker) {
      setError(blocker);
      setStatus("error");
      return;
    }

    const generation = ++generationRef.current;
    const isStale = () => generationRef.current !== generation;

    setError(null);
    setStatus("starting");

    const stream = await acquireStream(isStale);
    if (!stream) return;

    // The dialog closed while the permission prompt was up: release immediately
    // rather than leaving the camera light on behind a dismissed dialog.
    if (isStale()) {
      stopStream(stream);
      return;
    }

    streamRef.current = stream;
    setCapabilities(summariseTrackCapabilities(stream.getVideoTracks()[0] ?? null));

    if (!(await attachStream(stream))) {
      stopStream(stream);
      streamRef.current = null;
      return;
    }
    if (isStale()) {
      stopStream(stream);
      return;
    }

    // Warm the decoder before declaring the scanner live, so the first aimed
    // frame isn't dropped while ~930 KiB of wasm downloads.
    setStatus("loading-decoder");
    try {
      await loadDecoder();
    } catch {
      if (isStale()) return;
      setError({
        kind: "unknown",
        message: "The barcode decoder failed to load. Check your connection and try again, or type the tag instead.",
      });
      setStatus("error");
      stopStream(stream);
      streamRef.current = null;
      return;
    }
    if (isStale()) return;

    lastHitRef.current = null;
    runningRef.current = true;
    setStatus("scanning");
    schedulePump();
  }, [acquireStream, attachStream, schedulePump]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      // `torch` is not in TS's MediaTrackConstraintSet — it's an extension
      // Android implements and iOS does not. `capabilities.torch` gates the UI,
      // so reaching here already means the track advertised it.
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      // Some Android devices advertise torch and then refuse the constraint.
      // Leave the state untoggled so the button reflects reality.
    }
  }, [torchOn]);

  /**
   * Rule 5 — release on hide, re-acquire on show.
   *
   * Registered unconditionally, not gated on `status`: after a hide the status
   * IS "idle", so a status-gated listener would have torn itself down and the
   * viewport would stay black for the rest of the session — which is the exact
   * iOS symptom this rule exists to prevent.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // `release()` bumps the generation, so an in-flight start() aborts too,
        // and leaves `wantsCameraRef` set so the branch below can reverse it.
        if (wantsCameraRef.current) release();
        return;
      }
      if (wantsCameraRef.current && !runningRef.current) void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [release, start]);

  // Teardown on unmount is not optional: a leaked track on iOS blocks the NEXT
  // getUserMedia anywhere in the app (one capture at a time).
  useEffect(() => stop, [stop]);

  return { status, error, capabilities, torchOn, videoRef, start, stop, toggleTorch };
}
