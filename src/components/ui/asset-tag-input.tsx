"use client";

import { forwardRef } from "react";
import { Input } from "@/components/ui/input";

interface AssetTagInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Called when value changes (from typing) */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /**
   * Called when a tag is committed by an external scanner (e.g. a USB/Bluetooth
   * HID barcode wedge that "types" the value then fires Enter). Manual entry
   * still flows through the host's own `onChange` / `onKeyDown` / form submit —
   * this is kept only so call sites can pass the same handler they used before.
   */
  onScan?: (value: string) => void;
  /** Accepted for drop-in compatibility with the removed camera scanner. Ignored. */
  scannerTitle?: string;
  /** Accepted for drop-in compatibility with the removed camera scanner. Ignored. */
  showScanButton?: boolean;
  /** Accepted for drop-in compatibility with the removed camera scanner. Ignored. */
  continuous?: boolean;
}

/**
 * Plain text input for entering asset / test tags.
 *
 * Drop-in replacement for the old `ScanInput` with the in-app camera scanner
 * removed (the camera path never worked reliably on iPhone). Manual typing —
 * and external HID barcode wedges, which behave like a keyboard — still work
 * everywhere. The `onScan` / `scannerTitle` / `showScanButton` / `continuous`
 * props are accepted and ignored so existing call sites only need to swap the
 * import + element name.
 */
export const AssetTagInput = forwardRef<HTMLInputElement, AssetTagInputProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ onScan, scannerTitle, showScanButton, continuous, className, ...props }, ref) => {
    return <Input ref={ref} className={className} {...props} />;
  }
);

AssetTagInput.displayName = "AssetTagInput";
