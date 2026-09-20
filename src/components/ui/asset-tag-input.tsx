"use client";

import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { ScanButton } from "@/components/scanner/scan-button";
import { cn } from "@/lib/utils";

interface AssetTagInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Called when value changes (from typing) */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /**
   * Called when a tag is committed by a scan — either the in-app camera scanner
   * (the button this component renders) or an external USB/Bluetooth HID
   * barcode wedge, which "types" the value then fires Enter. Manual entry still
   * flows through the host's own `onChange` / `onKeyDown` / form submit.
   */
  onScan?: (value: string) => void;
  /** Heading for the scanner dialog, and the button's accessible name. */
  scannerTitle?: string;
  /**
   * Render the camera button. Defaults to true wherever `onScan` is supplied —
   * without a handler there is nowhere for a decode to go, so the button would
   * open a camera that does nothing.
   *
   * Pass `false` where the field sits inside a `relative` box with absolutely
   * positioned overlays, and place a `<ScanButton>` as a sibling instead (see
   * the warehouse and returns hero search bars).
   */
  showScanButton?: boolean;
  /** Keep the camera live after a hit, for batch scanning (warehouse tabs). */
  continuous?: boolean;
}

/**
 * Text input for asset / test tags, with an in-app camera scanner button.
 *
 * Three entry paths, all landing in the same place:
 * - **Typing** — the host's own `onChange` / keydown handling, unchanged.
 * - **HID wedge** — a USB/Bluetooth scanner is a keyboard; it types and hits
 *   Enter, which the host's existing submit path already handles.
 * - **Camera** — `<ScanButton>`, via `CameraScannerDialog`, calling `onScan`.
 *
 * The camera path was removed once because it never worked on iPhone. It is
 * back on a different engine and a different set of platform assumptions — see
 * `src/lib/barcode/camera.ts` and `docs/designs/barcode-scanner-2d.md` for what
 * changed and why.
 */
export const AssetTagInput = forwardRef<HTMLInputElement, AssetTagInputProps>(
  ({ onScan, scannerTitle = "Scan tag", showScanButton, continuous = false, className, ...props }, ref) => {
    const showButton = (showScanButton ?? Boolean(onScan)) && Boolean(onScan);

    if (!showButton) {
      return <Input ref={ref} className={className} {...props} />;
    }

    return (
      // `className` still lands on the Input, not this wrapper — every existing
      // call site styles the FIELD through it (heights, padding for an overlaid
      // icon), and diverting it here would silently restyle ten surfaces.
      <div className="flex w-full items-center gap-2">
        <Input ref={ref} className={cn("min-w-0 flex-1", className)} {...props} />
        <ScanButton
          onScan={(value) => onScan?.(value)}
          scannerTitle={scannerTitle}
          continuous={continuous}
          // Disabled alongside the field it belongs to — scanning into a
          // disabled input would fire a write the host has deliberately paused.
          disabled={props.disabled}
        />
      </div>
    );
  },
);

AssetTagInput.displayName = "AssetTagInput";
