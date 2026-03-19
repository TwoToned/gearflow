"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Zap, ZapOff, Camera, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BarcodeScannerProps {
  open: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
  /** Optional title shown in the scanner overlay */
  title?: string;
  /** If true, scanner stays open after a scan for continuous scanning */
  continuous?: boolean;
}

/**
 * Camera barcode/QR scanner overlay.
 * Compact inline mode — not full-screen.
 * Uses html5-qrcode for camera-based scanning.
 * Supports rear camera, torch toggle, camera switching, and continuous mode.
 */
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

export function BarcodeScanner({ open, onScan, onClose, title = "Scan barcode or QR code", continuous = false }: BarcodeScannerProps) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [currentCameraIdx, setCurrentCameraIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const cooldownRef = useRef(false);
  const activeRef = useRef(false);

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
      const { Html5Qrcode } = await import("html5-qrcode");

      await stopScanner();

      const elementId = "barcode-scanner-viewport";
      // Ensure the element exists
      if (!document.getElementById(elementId)) {
        const div = document.createElement("div");
        div.id = elementId;
        scannerRef.current.appendChild(div);
      }

      const scanner = new Html5Qrcode(elementId);
      html5QrRef.current = scanner;

      // Get available cameras
      const devices = await Html5Qrcode.getCameras();
      if (devices.length === 0) {
        setError("No cameras found on this device.");
        setStarting(false);
        return;
      }
      setCameras(devices);

      // Prefer back/rear camera
      const backCamera = devices.find(
        (d) => /back|rear|environment/i.test(d.label)
      );
      const selectedCamera = cameraId || backCamera?.id || devices[devices.length - 1].id;
      const selectedIdx = devices.findIndex((d) => d.id === selectedCamera);
      if (selectedIdx >= 0) setCurrentCameraIdx(selectedIdx);

      activeRef.current = true;
      await scanner.start(
        selectedCamera,
        { fps: 10 },
        (decodedText) => {
          // Guard against callbacks firing after scanner is stopped
          if (!activeRef.current) return;
          // In continuous mode, debounce same code for 2 seconds
          if (cooldownRef.current) return;
          cooldownRef.current = true;
          setTimeout(() => { cooldownRef.current = false; }, 2000);

          // Feedback on scan
          if (navigator.vibrate) navigator.vibrate(200);
          playScanChime();
          setLastScanned(decodedText);
          onScanRef.current(decodedText);

          if (!continuousRef.current) {
            // Brief delay before closing so user sees the scan registered
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

      // Check torch support
      try {
        const track = scanner.getRunningTrackCameraCapabilities?.();
        if (track && "torchFeature" in track) {
          const torchFeature = (track as { torchFeature: () => { isSupported: () => boolean } }).torchFeature();
          setTorchSupported(torchFeature.isSupported());
        }
      } catch {
        setTorchSupported(false);
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
  }, [stopScanner]);

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
    await stopScanner();
    await startScanner(cameras[nextIdx].id);
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

      {/* Status bar */}
      {continuous && lastScanned && (
        <div className="px-3 py-1.5 border-t bg-green-500/10 text-green-600 text-xs font-medium flex items-center gap-2">
          <span>Scanned: {lastScanned}</span>
        </div>
      )}
    </div>
  );
}
