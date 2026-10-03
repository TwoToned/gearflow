"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraScannerDialog } from "@/components/scanner/camera-scanner-dialog";
import { cn } from "@/lib/utils";

interface ScanButtonProps {
  /** Receives each accepted decode. */
  onScan: (value: string) => void;
  /** Dialog heading, and the button's accessible name. Say what's being scanned. */
  scannerTitle?: string;
  /** Keep the camera live after a hit, for batch scanning. */
  continuous?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The camera-scanner trigger, on its own.
 *
 * `AssetTagInput` renders one of these next to its field, which covers most
 * call sites in a single prop. This standalone export is for the surfaces whose
 * field sits in a `relative` box carrying absolutely-positioned overlays (the
 * warehouse and returns hero search bars) — there the button has to be a flex
 * sibling of that box, or it lands underneath the overlays.
 *
 * Either way there is ONE implementation of "open the camera, hand back a
 * value": a second call site that rolled its own dialog state could drift on
 * duplicate suppression or on releasing the camera, and a leaked track on iOS
 * blocks the next getUserMedia app-wide.
 */
export function ScanButton({
  onScan,
  scannerTitle = "Scan barcode",
  continuous = false,
  disabled,
  className,
}: ScanButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="line"
        size="icon"
        className={cn("shrink-0", className)}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={scannerTitle}
      >
        <ScanLine aria-hidden="true" />
      </Button>
      {/* Mounted only while open, so the camera hook cannot exist behind a
          closed dialog. */}
      {open && (
        <CameraScannerDialog
          open={open}
          onOpenChange={setOpen}
          onScan={onScan}
          title={scannerTitle}
          continuous={continuous}
        />
      )}
    </>
  );
}
