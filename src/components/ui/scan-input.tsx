"use client";

import { useState, forwardRef, useEffect } from "react";
import { ScanBarcode } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BarcodeScanner } from "@/components/ui/barcode-scanner";

interface ScanInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  /** Called when value changes (from typing or scanning) */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Called when a barcode is scanned (receives the scanned value directly) */
  onScan?: (value: string) => void;
  /** Title shown in the scanner overlay */
  scannerTitle?: string;
  /** Whether to show the scan button (default: true on devices with cameras) */
  showScanButton?: boolean;
  /** If true, scanner stays open after a scan for continuous scanning */
  continuous?: boolean;
}

/**
 * Text input with an optional camera scan button for barcode/QR scanning.
 * Drop-in replacement for Input where tag scanning is needed.
 */
export const ScanInput = forwardRef<HTMLInputElement, ScanInputProps>(
  ({ onScan, scannerTitle = "Scan barcode", showScanButton, continuous = false, className, ...props }, ref) => {
    const [scannerOpen, setScannerOpen] = useState(false);
    const [hasCamera, setHasCamera] = useState(false);

    // Check if device likely has a camera
    useEffect(() => {
      if (showScanButton !== undefined) {
        setHasCamera(showScanButton); // eslint-disable-line react-hooks/set-state-in-effect
        return;
      }
      // Check for mediaDevices API
      if (typeof navigator !== "undefined" && navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices?.().then((devices) => {
          setHasCamera(devices.some((d) => d.kind === "videoinput"));
        }).catch(() => {
          // Default to true on touch devices (phones/tablets likely have cameras)
          setHasCamera("ontouchstart" in window);
        });
      } else {
        setHasCamera("ontouchstart" in window);
      }
    }, [showScanButton]);

    const handleScan = (value: string) => {
      if (onScan) {
        onScan(value);
      } else if (ref && typeof ref !== "function" && ref.current) {
        // Fallback: set the input value via native setter to trigger React's onChange
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(ref.current, value);
        ref.current.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };

    if (!hasCamera) {
      return <Input ref={ref} className={className} {...props} />;
    }

    return (
      <div className="space-y-2">
        <div className="relative flex items-center">
          <Input ref={ref} className={`pr-10 ${className || ""}`} {...props} />
          <button
            type="button"
            onClick={() => setScannerOpen(!scannerOpen)}
            className={`absolute right-1 h-8 w-8 flex items-center justify-center rounded-md transition-colors ${
              scannerOpen
                ? "text-primary bg-primary/10"
                : "text-fg-3 hover:text-fg hover:bg-accent"
            }`}
            title="Scan with camera"
          >
            <ScanBarcode className="h-4 w-4" />
          </button>
        </div>
        <BarcodeScanner
          open={scannerOpen}
          onScan={handleScan}
          onClose={() => setScannerOpen(false)}
          title={scannerTitle}
          continuous={continuous}
        />
      </div>
    );
  }
);

ScanInput.displayName = "ScanInput";
