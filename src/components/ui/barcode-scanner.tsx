"use client";

import { useEffect, useId, useRef, useState, useCallback } from "react";
import { X, Zap, ZapOff, Camera, SwitchCamera, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BarcodeScannerProps {
  open: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
  /** Optional title shown in the scanner overlay */
  title?: string;
  /** If true, scanner stays open after a scan for continuous scanning */
  continuous?: boolean;
  /** If true, scan the full camera frame instead of a centered crop box.
   * Helps with small/offset codes (e.g. asset tags photographed at an angle). */
  fullFrame?: boolean;
}

/**
 * Camera barcode/QR scanner overlay.
 * Compact inline mode — not full-screen.
 * Uses html5-qrcode for camera-based scanning.
 *
 * Wave 2 hardening (2.D):
 *   - Per-instance DOM id (was hardcoded — two open scanners collided)
 *   - playsInline / muted forced on the video element before play() so iOS
 *     Safari actually streams instead of opening a fullscreen black player
 *   - Last-picked camera persisted to localStorage (resets to rear on first
 *     mount but remembers a deliberate switch across sessions)
 *   - Zoom slider when MediaTrackCapabilities.zoom is supported
 *   - Micro QR added to the supported-formats list
 *   - Optional fullFrame prop for camera-pointed-at-a-shelf scenarios
 */
const CAMERA_PREF_KEY = "gearflow.scanner.preferredCameraId";

function playScanChime() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    // Audio not available
  }
}

/** iOS Safari requires playsInline + muted set BEFORE play() — html5-qrcode
 * doesn't always do this reliably. We belt-and-suspender it post-start. */
function ensureIOSPlaysInline(viewportEl: HTMLElement | null): HTMLVideoElement | null {
  if (!viewportEl) return null;
  const video = viewportEl.querySelector("video") as HTMLVideoElement | null;
  if (!video) return null;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.muted = true;
  return video;
}

export function BarcodeScanner({
  open,
  onScan,
  onClose,
  title = "Scan barcode or QR code",
  continuous = false,
  fullFrame = false,
}: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [currentCameraIdx, setCurrentCameraIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null);
  const cooldownRef = useRef(false);
  const activeRef = useRef(false);

  // Stable per-instance viewport id. Without this, two scanners mounted at
  // the same time (e.g. mobile-nav scan shortcut + warehouse scan input)
  // collide on `barcode-scanner-viewport` and one silently fails.
  const instanceId = useId().replace(/:/g, "");
  const viewportElementId = `barcode-scanner-viewport-${instanceId}`;

  // Stable refs for callbacks so startScanner doesn't depend on them
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  const stopScanner = useCallback(async () => {
    activeRef.current = false;
    if (html5QrRef.current) {
      try {
        const state = html5QrRef.current.getState();
        if (state === 2 /* SCANNING */ || state === 3 /* PAUSED */) {
          await html5QrRef.current.stop();
        }
      } catch {
        // ignore stop errors
      }
      html5QrRef.current = null;
    }
  }, []);

  const startScanner = useCallback(async (cameraId?: string) => {
    if (!scannerRef.current) return;
    setStarting(true);
    setError(null);

    try {
      // Dynamic import to keep bundle small when scanner isn't used
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");

      await stopScanner();

      // Ensure the per-instance viewport exists
      if (!document.getElementById(viewportElementId)) {
        const div = document.createElement("div");
        div.id = viewportElementId;
        scannerRef.current.appendChild(div);
      }

      // Micro QR isn't always exported in every html5-qrcode version — guard with a runtime check.
      const formats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.PDF_417,
        Html5QrcodeSupportedFormats.AZTEC,
      ];
      const formatsAny = Html5QrcodeSupportedFormats as unknown as Record<string, number | undefined>;
      if (typeof formatsAny.MICRO_QR_CODE === "number") {
        formats.push(formatsAny.MICRO_QR_CODE as unknown as typeof Html5QrcodeSupportedFormats.QR_CODE);
      }

      const scanner = new Html5Qrcode(viewportElementId, {
        verbose: false,
        useBarCodeDetectorIfSupported: true,
        formatsToSupport: formats,
      });
      html5QrRef.current = scanner;

      // Get available cameras
      const devices = await Html5Qrcode.getCameras();
      if (devices.length === 0) {
        setError("No cameras found on this device.");
        setStarting(false);
        return;
      }
      setCameras(devices);

      // Camera priority: explicit cameraId param → localStorage pref → back/rear → last device.
      const storedPref = typeof window !== "undefined"
        ? window.localStorage.getItem(CAMERA_PREF_KEY) ?? undefined
        : undefined;
      const storedPrefStillExists = storedPref && devices.some((d) => d.id === storedPref);
      const backCamera = devices.find((d) => /back|rear|environment/i.test(d.label));
      const selectedCamera =
        cameraId ||
        (storedPrefStillExists ? storedPref : undefined) ||
        backCamera?.id ||
        devices[devices.length - 1].id;
      const selectedIdx = devices.findIndex((d) => d.id === selectedCamera);
      if (selectedIdx >= 0) setCurrentCameraIdx(selectedIdx);

      activeRef.current = true;
      await scanner.start(
        selectedCamera!,
        {
          fps: 15,
          // Full-frame mode skips the centered crop box so off-center codes scan.
          qrbox: fullFrame
            ? undefined
            : (viewfinderWidth: number, viewfinderHeight: number) => {
                const width = Math.floor(Math.min(viewfinderWidth * 0.85, 400));
                const height = Math.floor(Math.min(viewfinderHeight * 0.7, width));
                return { width, height };
              },
          videoConstraints: {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            advanced: [
              { focusMode: "continuous" } as MediaTrackConstraintSet,
            ],
          },
        },
        (decodedText) => {
          if (!activeRef.current) return;
          if (cooldownRef.current) return;
          cooldownRef.current = true;
          setTimeout(() => { cooldownRef.current = false; }, 2000);

          if (navigator.vibrate) navigator.vibrate(200);
          playScanChime();
          setLastScanned(decodedText);
          onScanRef.current(decodedText);

          if (!continuousRef.current) {
            setTimeout(() => {
              stopScanner();
              onCloseRef.current();
            }, 300);
          }
        },
        () => {
          // QR code not found — normal during scanning, ignore
        }
      );

      // iOS: ensure playsInline so the video doesn't go fullscreen
      const video = ensureIOSPlaysInline(scannerRef.current);

      // Probe torch + zoom support on the live track.
      try {
        const track = scanner.getRunningTrackCameraCapabilities?.();
        if (track && "torchFeature" in track) {
          const torchFeature = (track as { torchFeature: () => { isSupported: () => boolean } }).torchFeature();
          setTorchSupported(torchFeature.isSupported());
        }
      } catch {
        setTorchSupported(false);
      }
      try {
        const videoTrack = video?.srcObject instanceof MediaStream
          ? video.srcObject.getVideoTracks()[0]
          : null;
        if (videoTrack) {
          const caps = videoTrack.getCapabilities?.() as
            MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number; step: number } };
          if (caps?.focusMode?.includes("continuous")) {
            void videoTrack.applyConstraints({
              advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
            });
          }
          if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
            const settings = videoTrack.getSettings?.() as MediaTrackSettings & { zoom?: number };
            setZoom({
              min: caps.zoom.min,
              max: caps.zoom.max,
              step: caps.zoom.step || 0.1,
              value: settings.zoom ?? caps.zoom.min,
            });
          }
        }
      } catch {
        // Capabilities probe failed — controls just hide
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      if (msg.includes("NotAllowedError") || msg.includes("Permission")) {
        setError("Camera permission denied. Please allow camera access in your browser settings.");
      } else {
        setError(msg);
      }
    } finally {
      setStarting(false);
    }
  }, [stopScanner, viewportElementId, fullFrame]);

  useEffect(() => {
    if (open) {
      setLastScanned(null);
      startScanner();
    } else {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [open, startScanner, stopScanner]);

  const toggleTorch = async () => {
    if (!html5QrRef.current) return;
    try {
      const track = html5QrRef.current.getRunningTrackCameraCapabilities?.();
      if (track && "torchFeature" in track) {
        const torchFeature = (track as { torchFeature: () => { apply: (v: boolean) => Promise<void> } }).torchFeature();
        await torchFeature.apply(!torch);
        setTorch(!torch);
      }
    } catch {
      // Torch toggle failed
    }
  };

  const switchCamera = async () => {
    if (cameras.length <= 1) return;
    const nextIdx = (currentCameraIdx + 1) % cameras.length;
    setCurrentCameraIdx(nextIdx);
    // Remember the deliberate switch
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CAMERA_PREF_KEY, cameras[nextIdx].id);
    }
    await stopScanner();
    await startScanner(cameras[nextIdx].id);
  };

  const applyZoom = async (value: number) => {
    if (!html5QrRef.current || !zoom) return;
    try {
      const video = scannerRef.current?.querySelector("video") as HTMLVideoElement | null;
      const videoTrack = video?.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0] : null;
      if (!videoTrack) return;
      await videoTrack.applyConstraints({
        advanced: [{ zoom: value } as unknown as MediaTrackConstraintSet],
      });
      setZoom({ ...zoom, value });
    } catch {
      // zoom apply failed — ignore
    }
  };

  if (!open) return null;

  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-bg-inset/50">
        <span className="text-sm font-medium truncate">{title}</span>
        <div className="flex items-center gap-1">
          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
              aria-label="Switch camera"
            >
              <SwitchCamera className="h-4 w-4" />
            </button>
          )}
          {torchSupported && (
            <button
              onClick={toggleTorch}
              className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors ${torch ? "bg-yellow-500/20 text-yellow-500" : "hover:bg-accent"}`}
              aria-label="Toggle flashlight"
            >
              {torch ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={() => { stopScanner(); onClose(); }}
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
            aria-label="Close scanner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scanner viewport */}
      <div className="relative bg-black scanner-viewport" ref={scannerRef}>
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <div className="flex flex-col items-center gap-2">
              <Camera className="h-8 w-8 animate-pulse" />
              <span className="text-xs">Starting camera...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-center max-w-sm">
              <p className="text-xs text-destructive-foreground mb-2">{error}</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => startScanner()}>
                  Retry
                </Button>
                <Button variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Zoom slider — shown only when the camera supports it */}
      {zoom && !error && (
        <div className="flex items-center gap-2 px-3 py-2 border-t bg-bg-inset/30">
          <ZoomOut className="h-3.5 w-3.5 text-fg-3" />
          <input
            type="range"
            min={zoom.min}
            max={zoom.max}
            step={zoom.step}
            value={zoom.value}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="flex-1 h-1 accent-primary"
            aria-label="Zoom level"
          />
          <ZoomIn className="h-3.5 w-3.5 text-fg-3" />
          <span className="text-[10px] tabular-nums text-fg-4 w-8 text-right">
            {zoom.value.toFixed(1)}×
          </span>
        </div>
      )}

      {/* Status bar */}
      {continuous && lastScanned && (
        <div className="px-3 py-1.5 border-t bg-green-500/10 text-green-600 text-xs font-medium flex items-center gap-2">
          <span>Scanned: {lastScanned}</span>
        </div>
      )}
    </div>
  );
}
