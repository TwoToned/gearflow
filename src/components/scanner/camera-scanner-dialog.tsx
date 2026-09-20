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
import { useCameraScanner, type ScanResult } from "@/hooks/use-camera-scanner";
import { ROI_FRACTION } from "@/lib/barcode/camera";
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
 * Full-screen camera barcode scanner (#1278).
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

  const busy = status === "starting" || status === "loading-decoder";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isMobile
            ? "h-[100dvh] max-h-[100dvh] w-full max-w-full rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col"
            : "sm:max-w-xl p-0 gap-0 overflow-hidden"
        }
        style={
          isMobile
            ? { paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }
            : undefined
        }
      >
        <DialogHeader className="px-4 pt-4 pb-3 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Hold the code inside the frame. Works with QR, Micro QR, rMQR, Data Matrix, and standard
            barcodes.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex-1 min-h-0 bg-black">
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

          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center px-6">
              <Loader2 className="size-8 animate-spin text-white" aria-hidden="true" />
              <p className="text-ui-text text-white">
                {status === "starting" ? "Starting camera…" : "Loading decoder…"}
              </p>
            </div>
          )}

          {status === "error" && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
              <TriangleAlert className="size-8 text-white" aria-hidden="true" />
              <p className="text-ui-text text-white max-w-sm" role="alert">
                {error.message}
              </p>
              {/* A retry is genuinely useful on iOS, where an installed PWA can
                  lose a previously-granted camera permission between launches. */}
              <Button variant="cream" onClick={() => void start()}>
                <Camera aria-hidden="true" />
                Try again
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-ui-text text-muted" aria-live="polite">
            {status === "scanning"
              ? lastFormat
                ? `Scanned ${lastFormat} — keep going`
                : "Searching for a code…"
              : " "}
          </p>
          <div className="flex items-center gap-2">
            {/* iOS exposes no torch control at all, so this button simply
                doesn't exist there rather than existing and doing nothing. */}
            {capabilities.torch && (
              <Button
                variant="line"
                size="icon"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
              >
                {torchOn ? <FlashlightOff aria-hidden="true" /> : <Flashlight aria-hidden="true" />}
              </Button>
            )}
            <Button variant="line" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
