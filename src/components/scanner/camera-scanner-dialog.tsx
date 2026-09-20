"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Flashlight, FlashlightOff, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCameraScanner, type ScanResult, type ScannerStatus } from "@/hooks/use-camera-scanner";
import { ROI_FRACTION, type CameraError } from "@/lib/barcode/camera";
import { useScanFeedback } from "@/hooks/use-scan-feedback";

interface CameraScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with each accepted decode. In one-shot mode the dialog closes after it. */
  onScan: (value: string) => void;
  /** Dialog heading — say what the operator is scanning ("Scan asset tag"). */
  title?: string;
  /** Keep the camera live after a hit, for batch scanning. */
  continuous?: boolean;
}

/**
 * Full-screen camera barcode scanner.
 *
 * Supports QR, **Micro QR** and **rMQR**, Data Matrix, Aztec, PDF417 and the
 * common linear symbologies — see `src/lib/barcode/formats.ts` for the list and
 * `src/lib/barcode/decoder.ts` for why it is one WASM engine on both platforms
 * rather than the platform `BarcodeDetector` where available.
 *
 * The viewport is deliberately full-bleed on phones: the reticle has to be big
 * enough that framing it puts real pixels on the symbol, which is what Micro QR
 * needs. The reticle geometry is derived from the SAME `ROI_FRACTION` the
 * decoder crops to, so what the operator frames is exactly what gets decoded —
 * two hand-tuned numbers here would mean the box lies about the scan area.
 */
export function CameraScannerDialog({
  open,
  onOpenChange,
  onScan,
  title = "Scan barcode",
  continuous = false,
}: CameraScannerDialogProps) {
  const isMobile = useIsMobile();
  const { play } = useScanFeedback();
  const [lastFormat, setLastFormat] = useState<string | null>(null);

  const handleResult = useCallback(
    (result: ScanResult) => {
      setLastFormat(result.format);
      play("success");
      onScan(result.value);
      if (!continuous) onOpenChange(false);
    },
    [continuous, onOpenChange, onScan, play],
  );

  const { status, error, capabilities, torchOn, videoRef, start, stop, toggleTorch } =
    useCameraScanner({ onResult: handleResult, continuous });

  // `start()` runs off the dialog's open transition, which is inside the click
  // that opened it — the user-gesture attribution Safari needs for the
  // permission prompt. Starting from a mount effect instead is what makes the
  // prompt silently fail on iOS.
  useEffect(() => {
    if (open) {
      void start();
      return;
    }
    stop();
    setLastFormat(null);
  }, [open, start, stop]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none border-0 p-0"
            : "gap-0 overflow-hidden p-0 sm:max-w-xl"
        }
        style={
          isMobile
            ? {
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }
            : undefined
        }
      >
        <DialogHeader className="px-4 pb-3 pt-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Hold the code inside the frame. Works with QR, Micro QR, rMQR, Data Matrix, and standard
            barcodes.
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-black">
          {/* `playsInline` + `muted` + `autoplay` are all three required for iOS
              to paint the stream rather than a black rectangle. */}
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
            autoPlay
            // Nothing to announce: the reticle and status line carry the state.
            aria-hidden="true"
          />

          {status === "scanning" && <ScanReticle />}
          <ViewportOverlay status={status} error={error} onRetry={() => void start()} />
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-ui-text text-muted" aria-live="polite">
            {statusLine(status, lastFormat)}
          </p>
          <div className="flex items-center gap-2">
            {/* iOS exposes no torch control at all, so this button simply
                doesn't exist there rather than existing and doing nothing. */}
            {capabilities.torch && <TorchToggle on={torchOn} onToggle={() => void toggleTorch()} />}
            <Button variant="line" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The footer's one line of state. A non-breaking space holds the row's height. */
function statusLine(status: ScannerStatus, lastFormat: string | null): string {
  if (status !== "scanning") return " ";
  return lastFormat ? `Scanned ${lastFormat} — keep going` : "Searching for a code…";
}

/**
 * What covers the viewport when it isn't showing a live picture: the startup /
 * decoder-download wait, or a failure with a way out of it.
 */
function ViewportOverlay({
  status,
  error,
  onRetry,
}: {
  status: ScannerStatus;
  error: CameraError | null;
  onRetry: () => void;
}) {
  if (status === "starting" || status === "loading-decoder") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
        <Loader2 className="size-8 animate-spin text-white" aria-hidden="true" />
        <p className="text-ui-text text-white">
          {status === "starting" ? "Starting camera…" : "Loading decoder…"}
        </p>
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
        <TriangleAlert className="size-8 text-white" aria-hidden="true" />
        <p className="text-ui-text max-w-sm text-white" role="alert">
          {error.message}
        </p>
        {/* A retry is genuinely useful on iOS, where an installed PWA can lose a
            previously-granted camera permission between launches. */}
        <Button variant="cream" onClick={onRetry}>
          <Camera aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  return null;
}

function TorchToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="line"
      size="icon"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? "Turn torch off" : "Turn torch on"}
    >
      {on ? <FlashlightOff aria-hidden="true" /> : <Flashlight aria-hidden="true" />}
    </Button>
  );
}

/**
 * The aim box. Sized from `ROI_FRACTION` so it matches the decoded crop exactly
 * (see the component docblock), and `object-cover` on the video means the
 * shorter on-screen axis corresponds to the shorter frame axis the ROI is
 * derived from.
 */
function ScanReticle() {
  const size = `${Math.round(ROI_FRACTION * 100)}%`;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="rounded-[var(--radius)] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        style={{ width: `min(${size}, 340px)`, aspectRatio: "1 / 1" }}
      />
    </div>
  );
}
