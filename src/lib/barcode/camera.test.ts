import { describe, it, expect } from "vitest";
import {
  buildVideoConstraints,
  classifyCameraError,
  computeRoi,
  detectCameraBlocker,
  stopStream,
  summariseTrackCapabilities,
  ROI_FRACTION,
} from "./camera";

describe("buildVideoConstraints", () => {
  const video = () => buildVideoConstraints().video as MediaTrackConstraints;

  it("asks for the rear camera as IDEAL, never EXACT", () => {
    // `exact` rejects with OverconstrainedError on every device without a rear
    // camera (laptops, some iPad orientations) — which the first scanner showed
    // warehouse staff as an unexplained failure. `ideal` degrades gracefully.
    expect(video().facingMode).toEqual({ ideal: "environment" });
  });

  it("never pins a deviceId", () => {
    // The classic iOS trap: before permission is granted, enumerateDevices()
    // returns blank labels and deviceIds, so "pick the back camera by label"
    // picks nothing. facingMode is the only pre-permission selector that works.
    expect(video().deviceId).toBeUndefined();
  });

  it("requests 1080p, since the web cannot select the close-focusing lens", () => {
    // MediaDevices has no concept of lens type, so we can't ask for the
    // ultra-wide the way AVFoundation can. Resolution substitutes for optics.
    expect(video().width).toEqual({ ideal: 1920 });
    expect(video().height).toEqual({ ideal: 1080 });
  });

  it("never requests audio", () => {
    expect(buildVideoConstraints().audio).toBe(false);
  });
});

describe("classifyCameraError", () => {
  const kindOf = (name: string) => classifyCameraError(Object.assign(new Error(name), { name })).kind;

  it("treats a denial as a recoverable state with real instructions", () => {
    const result = classifyCameraError(Object.assign(new Error(), { name: "NotAllowedError" }));
    expect(result.kind).toBe("denied");
    // An installed iOS PWA can lose a previously-granted permission between
    // launches, so this message has to point at Settings, not just say "denied".
    expect(result.message).toMatch(/Settings/);
  });

  it("maps a missing or unsatisfiable camera to no-camera", () => {
    expect(kindOf("NotFoundError")).toBe("no-camera");
    expect(kindOf("OverconstrainedError")).toBe("no-camera");
  });

  it("maps a busy device to in-use", () => {
    expect(kindOf("NotReadableError")).toBe("in-use");
    expect(kindOf("AbortError")).toBe("in-use");
  });

  it("maps SecurityError to denied, not unknown", () => {
    expect(kindOf("SecurityError")).toBe("denied");
  });

  it("falls back to unknown for anything unrecognised, including non-errors", () => {
    expect(kindOf("SomethingElse")).toBe("unknown");
    expect(classifyCameraError(null).kind).toBe("unknown");
    expect(classifyCameraError("a string").kind).toBe("unknown");
  });

  it("always produces an actionable message", () => {
    for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "Whatever"]) {
      const { message } = classifyCameraError(Object.assign(new Error(), { name }));
      expect(message.length).toBeGreaterThan(20);
    }
  });
});

describe("detectCameraBlocker", () => {
  const withGum = { mediaDevices: { getUserMedia: () => Promise.resolve({}) } } as unknown as Navigator;

  it("passes when the API exists in a secure context", () => {
    expect(detectCameraBlocker(withGum, true)).toBeNull();
  });

  it("flags an insecure origin before touching the camera", () => {
    // The dev-box case: a phone pointed at http://192.168.x.x gets no
    // mediaDevices and NO error — historically read as "the scanner is broken
    // on my phone" when it was the URL.
    const blocker = detectCameraBlocker(withGum, false);
    expect(blocker?.kind).toBe("insecure");
    expect(blocker?.message).toMatch(/HTTPS/);
  });

  it("flags a browser with no getUserMedia", () => {
    expect(detectCameraBlocker({ mediaDevices: undefined } as unknown as Navigator, true)?.kind).toBe(
      "unsupported",
    );
  });

  it("flags a missing navigator (SSR)", () => {
    expect(detectCameraBlocker(undefined, true)?.kind).toBe("unsupported");
  });
});

describe("summariseTrackCapabilities", () => {
  it("reports nothing for a null track", () => {
    expect(summariseTrackCapabilities(null)).toEqual({ torch: false, zoom: false });
  });

  it("reports nothing when getCapabilities is absent — the iOS case", () => {
    // iOS exposes neither torch nor zoom. The UI must hide those controls
    // rather than render a button that silently does nothing.
    const track = {} as MediaStreamTrack;
    expect(summariseTrackCapabilities(track)).toEqual({ torch: false, zoom: false });
  });

  it("reports nothing when getCapabilities throws", () => {
    const track = {
      getCapabilities: () => {
        throw new Error("not implemented");
      },
    } as unknown as MediaStreamTrack;
    expect(summariseTrackCapabilities(track)).toEqual({ torch: false, zoom: false });
  });

  it("reports what an Android track advertises", () => {
    const track = {
      getCapabilities: () => ({ torch: true, zoom: { min: 1, max: 4 } }),
    } as unknown as MediaStreamTrack;
    expect(summariseTrackCapabilities(track)).toEqual({ torch: true, zoom: true });
  });

  it("does not report torch when only zoom is advertised", () => {
    const track = { getCapabilities: () => ({ zoom: { min: 1, max: 4 } }) } as unknown as MediaStreamTrack;
    expect(summariseTrackCapabilities(track)).toEqual({ torch: false, zoom: true });
  });
});

describe("stopStream", () => {
  it("stops every track", () => {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [
        { stop: () => stopped.push("a") },
        { stop: () => stopped.push("b") },
      ],
    } as unknown as MediaStream;
    stopStream(stream);
    expect(stopped).toEqual(["a", "b"]);
  });

  it("tolerates null", () => {
    expect(() => stopStream(null)).not.toThrow();
  });

  it("never throws, even if a track does", () => {
    // Teardown is usually an unmount; a throw there would strand the NEXT open,
    // and on iOS a leaked track blocks getUserMedia app-wide.
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [
        {
          stop: () => {
            throw new Error("already ended");
          },
        },
        { stop: () => stopped.push("b") },
      ],
    } as unknown as MediaStream;
    expect(() => stopStream(stream)).not.toThrow();
    expect(stopped).toEqual(["b"]);
  });
});

describe("computeRoi", () => {
  it("centres the crop", () => {
    const roi = computeRoi(1920, 1080);
    expect(roi.sx + roi.sWidth / 2).toBeCloseTo(960, 0);
    expect(roi.sy + roi.sHeight / 2).toBeCloseTo(540, 0);
  });

  it("derives the box from the SHORTER side", () => {
    // Landscape and portrait frames of the same short edge must crop the same
    // height, or the on-screen reticle would lie about the scan area.
    expect(computeRoi(1920, 1080).sHeight).toBe(Math.round(1080 * ROI_FRACTION));
    expect(computeRoi(1080, 1920).sHeight).toBe(Math.round(1080 * ROI_FRACTION));
  });

  it("crops at native resolution — the Micro QR requirement", () => {
    // Cropping rather than downscaling the whole frame is what keeps enough
    // pixels per module for an 11x11 Micro QR symbol to binarise.
    const roi = computeRoi(1920, 1080);
    expect(roi.sWidth).toBeLessThan(1920);
    expect(roi.sHeight).toBeLessThan(1080);
    expect(roi.sWidth * roi.sHeight).toBeGreaterThan(200_000);
  });

  it("widens past the square box so linear codes fit", () => {
    const roi = computeRoi(1920, 1080);
    expect(roi.sWidth).toBeGreaterThan(roi.sHeight);
  });

  it("never exceeds the frame, even on a narrow one", () => {
    for (const [w, h] of [[640, 480], [480, 640], [320, 240], [1080, 1080]] as const) {
      const roi = computeRoi(w, h);
      expect(roi.sx).toBeGreaterThanOrEqual(0);
      expect(roi.sy).toBeGreaterThanOrEqual(0);
      expect(roi.sx + roi.sWidth).toBeLessThanOrEqual(w);
      expect(roi.sy + roi.sHeight).toBeLessThanOrEqual(h);
    }
  });

  it("produces a non-empty crop at small frame sizes", () => {
    const roi = computeRoi(320, 240);
    expect(roi.sWidth).toBeGreaterThan(0);
    expect(roi.sHeight).toBeGreaterThan(0);
  });
});
