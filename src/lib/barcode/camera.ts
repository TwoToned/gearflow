/**
 * Pure camera helpers for the in-app scanner: constraint building, capability
 * probing, frame cropping and error classification.
 *
 * Everything here is a plain function over plain data so it can be unit-tested
 * without a camera — the parts that killed the first scanner (wrong constraints,
 * an unhandled `NotAllowedError`, an ROI computed off the wrong dimensions) are
 * all decidable from values, and this module is where they become decidable.
 *
 * ## The iOS brief, in one place
 *
 * WebKit is the whole story on iOS — every browser there is WKWebView, so
 * "works in Chrome on iPhone" and "works in Safari on iPhone" are the same
 * question. What that costs us:
 *
 * - **No `BarcodeDetector`.** Handled in `decoder.ts` (we use WASM everywhere).
 * - **No torch, no zoom, no `focusDistance`.** `getCapabilities()` on iOS
 *   returns none of them, and `applyConstraints({advanced:[{torch:true}]})` is a
 *   silent no-op. So we FEATURE-DETECT and hide the control: a dead torch button
 *   is worse than no torch button.
 * - **No lens selection.** `MediaDevices` has no concept of an ultra-wide vs
 *   wide lens, so a web page cannot ask for the one with the short minimum focus
 *   distance the way a native app can via `AVCaptureDevice.minimumFocusDistance`.
 *   On a modern iPhone `facingMode: "environment"` yields the wide camera, which
 *   will not focus closer than ~10 cm. Mitigation is resolution, not optics:
 *   ask for 1080p so a label is still resolvable from arm's length, and tell the
 *   operator to back off rather than lean in.
 * - **One live capture at a time.** A second `getUserMedia` steals the track
 *   from the first and leaves the original `<video>` black. Hence
 *   `stopStream` on every teardown path, not just the happy one.
 * - **Permission is not persisted for installed PWAs** (WebKit 215884), and this
 *   app ships `display: standalone`. The prompt can therefore reappear, and a
 *   denial is an ordinary state, not an exception — `classifyCameraError` gives
 *   it real recovery copy instead of a black rectangle.
 */

/** Ideal capture size. See the lens note above — resolution substitutes for optics. */
const IDEAL_WIDTH = 1920;
const IDEAL_HEIGHT = 1080;

/**
 * Constraints for the rear camera.
 *
 * `facingMode: { ideal: "environment" }` — **ideal, never exact**. `exact`
 * rejects with `OverconstrainedError` on any device without a rear camera
 * (every laptop, and iPads in some orientations), which the first scanner
 * surfaced to warehouse staff as an unexplained failure. `ideal` degrades to
 * the front camera, which is useless for scanning but at least shows a picture
 * and a comprehensible message.
 *
 * We never pass a `deviceId`. Enumerating first is the classic iOS trap: before
 * permission is granted `enumerateDevices()` returns entries with empty labels
 * and blank `deviceId`s, so "pick the back camera by label" picks nothing.
 * `facingMode` is the only selector that works pre-permission.
 */
export function buildVideoConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: IDEAL_WIDTH },
      height: { ideal: IDEAL_HEIGHT },
    },
  };
}

/**
 * Lens labels we never want for scanning: ultra-wide and macro lenses distort or
 * crop badly, telephoto cannot focus at arm's length, depth/IR sensors are not
 * colour cameras at all.
 */
const UNWANTED_LENS = /ultra|tele|macro|depth|infrared|\bir\b|monochrome|ir camera/i;
const BACK_LENS = /back|rear|environment|facing back/i;

/**
 * Pick the rear MAIN camera from a post-permission device list, or `null` to keep
 * whatever `facingMode` gave us.
 *
 * Android Chrome on multi-lens phones often hands `facingMode: "environment"` the
 * ultra-wide or a logical camera that hunts between lenses — a linear barcode
 * then arrives soft. Labels are only populated AFTER permission, which is why
 * this runs on the live stream's device list and never before `getUserMedia`
 * (see the `deviceId` note on `buildVideoConstraints`).
 */
export function pickBackCamera(devices: readonly MediaDeviceInfo[]): string | null {
  const back = devices.filter(
    (d) => d.kind === "videoinput" && d.deviceId && BACK_LENS.test(d.label),
  );
  if (back.length < 2) return null;
  const preferred = back.filter((d) => !UNWANTED_LENS.test(d.label));
  return (preferred[0] ?? back[0])?.deviceId ?? null;
}

/** Zoom factor applied where supported: lets the operator hold the phone beyond minimum focus distance. */
const TARGET_ZOOM = 1.8;

/**
 * Per-track tuning to apply once the stream exists, from its advertised
 * capabilities. `null` when there is nothing worth applying (iOS exposes none of
 * these, so this is a no-op there rather than a silent failed constraint).
 *
 * - `focusMode: "continuous"` — Android's default is frequently single-shot, so
 *   the lens focuses once on whatever was in frame at open and never again.
 * - `zoom` — a label read from ~25 cm at 1.8x fills the frame like one read from
 *   ~14 cm at 1x, which is inside most lenses' minimum focus distance.
 */
export function buildTrackTuning(caps: MediaTrackCapabilities | null): MediaTrackConstraintSet | null {
  if (!caps) return null;
  const tuning: Record<string, unknown> = {};
  const focusModes = (caps as { focusMode?: string[] }).focusMode;
  if (Array.isArray(focusModes) && focusModes.includes("continuous")) {
    tuning.focusMode = "continuous";
  }
  const zoom = (caps as { zoom?: { min?: number; max?: number } }).zoom;
  if (zoom && typeof zoom.max === "number") {
    const min = typeof zoom.min === "number" ? zoom.min : 1;
    tuning.zoom = Math.min(zoom.max, Math.max(min, TARGET_ZOOM));
  }
  return Object.keys(tuning).length > 0 ? (tuning as MediaTrackConstraintSet) : null;
}

type CameraErrorKind =
  | "denied"
  | "insecure"
  | "unsupported"
  | "no-camera"
  | "in-use"
  | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  /** Operator-facing sentence. Says what to DO, not what threw. */
  message: string;
}

/**
 * Map a `getUserMedia` rejection to something an operator can act on.
 *
 * The names are the spec's, but the mapping matters most on iOS, where a
 * standalone-PWA permission reset surfaces as a plain `NotAllowedError` with no
 * hint that Settings is where the fix lives.
 */
export function classifyCameraError(error: unknown): CameraError {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "denied",
        message:
          "Camera access was blocked. Allow the camera for this site, then try again — on iPhone that's Settings → Apps → Safari → Camera, or the ⓘ in the address bar.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        kind: "no-camera",
        message: "No camera was found on this device. Type the tag instead, or use a USB/Bluetooth scanner.",
      };
    case "NotReadableError":
    case "AbortError":
      return {
        kind: "in-use",
        message:
          "The camera could not be started — another app or tab is probably using it. Close the other one and try again.",
      };
    default:
      return {
        kind: "unknown",
        message: "The camera could not be started. Type the tag instead, or try reloading the page.",
      };
  }
}

/**
 * Why the scanner cannot even attempt to open, or `null` if it can.
 *
 * Checked BEFORE `getUserMedia` so we never show a camera viewport that was
 * never going to fill. `isSecureContext` is the one that bites in development:
 * a phone pointed at a dev box over plain `http://192.168.x.x` gets a missing
 * `navigator.mediaDevices` and no error at all — historically read as "the
 * scanner is broken on my phone" when it was the URL.
 */
export function detectCameraBlocker(
  nav: Pick<Navigator, "mediaDevices"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
  secure: boolean = typeof window !== "undefined" && window.isSecureContext,
): CameraError | null {
  if (!nav) {
    return { kind: "unsupported", message: "Camera scanning is not available here." };
  }
  if (!secure) {
    return {
      kind: "insecure",
      message:
        "Camera scanning needs a secure (HTTPS) connection. Open the app over HTTPS — browsers block the camera on plain http:// addresses other than localhost.",
    };
  }
  if (!nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== "function") {
    return {
      kind: "unsupported",
      message: "This browser doesn't support in-app camera scanning. Type the tag instead.",
    };
  }
  return null;
}

/** What the live track actually supports, after the stream exists. */
export interface TrackCapabilitySummary {
  torch: boolean;
  zoom: boolean;
}

/**
 * Probe a live track for the controls worth exposing.
 *
 * Always false on iOS — `getCapabilities` is either absent or returns an object
 * carrying neither key. Guarded rather than assumed because Android Chrome does
 * support both, and a warehouse torch is genuinely useful on a dark shelf.
 */
export function summariseTrackCapabilities(track: MediaStreamTrack | null): TrackCapabilitySummary {
  if (!track || typeof track.getCapabilities !== "function") {
    return { torch: false, zoom: false };
  }
  let caps: MediaTrackCapabilities;
  try {
    caps = track.getCapabilities();
  } catch {
    // Safari has historically thrown here rather than returning an empty object.
    return { torch: false, zoom: false };
  }
  return {
    torch: "torch" in caps,
    zoom: "zoom" in caps,
  };
}

/** Stop every track on a stream. Safe to call twice, and on `null`. */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A track already ended by the UA (tab backgrounded, device unplugged)
      // throws on stop in some engines. Teardown must never throw — the caller
      // is usually an unmount, where a throw would strand the next open.
    }
  }
}

export interface Roi {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
}

/**
 * Fraction of the frame's SHORTER side that the aim box covers. Matched to the
 * on-screen reticle so that what the operator frames is exactly what we decode.
 */
export const ROI_FRACTION = 0.72;

/**
 * The centred region of interest to decode, in source-frame pixels.
 *
 * Decoding a crop rather than the whole frame is the single biggest reliability
 * win, and it is counter-intuitive: it is faster (a quarter of the pixels) AND
 * it reads smaller codes, because we crop at NATIVE resolution instead of
 * downscaling a 1080p frame to something the decoder can chew. Micro QR is the
 * case that needs it — an 11×11-module symbol on a cable label has to survive
 * with enough pixels per module to binarise, and a whole-frame downscale is
 * exactly what destroys it.
 *
 * Width is widened past the square box so a linear barcode wider than the
 * reticle still fits — Code 128 serials routinely overhang it.
 */
export function computeRoi(frameWidth: number, frameHeight: number): Roi {
  const shortest = Math.min(frameWidth, frameHeight);
  const box = Math.round(shortest * ROI_FRACTION);
  const sHeight = Math.min(box, frameHeight);
  const sWidth = Math.min(Math.round(box * 1.35), frameWidth);
  return {
    sx: Math.max(0, Math.round((frameWidth - sWidth) / 2)),
    sy: Math.max(0, Math.round((frameHeight - sHeight) / 2)),
    sWidth,
    sHeight,
  };
}
