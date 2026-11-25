"use client";

import QRCode from "react-qr-code";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ModelLabel } from "@/lib/model-labels";

/**
 * `Print labels for all` (UX Phase 12, Q-7): one browser-print sheet with every unit's tag
 * as a QR code and its words, a grid that breaks cleanly across pages. No PDF type.
 * Only the sheet prints (the rest of the page is hidden for the print media).
 */
export function ModelPrintLabelsDialog({ open, onOpenChange, modelName, labels }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  labels: ModelLabel[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Labels for {modelName}</DialogTitle>
          <DialogDescription>{labels.length} {labels.length === 1 ? "label" : "labels"}: one per serialised unit and per bulk stock tag. Retired units are left out.</DialogDescription>
        </DialogHeader>
        <style>{`@media print { body * { visibility: hidden !important; } .model-labels-print, .model-labels-print * { visibility: visible !important; } .model-labels-print { position: absolute; left: 0; top: 0; width: 100%; } .model-label { break-inside: avoid; } }`}</style>
        <div className="model-labels-print grid grid-cols-2 gap-3 sm:grid-cols-3">
          {labels.map((l) => (
            <div key={`${l.kind}:${l.tag}`} className="model-label flex flex-col items-center gap-1.5 rounded-[var(--r)] border border-line-2 bg-white p-3">
              <QRCode value={l.tag} size={96} />
              <p className="t-mono text-table-cell font-medium text-ink">{l.tag}</p>
              <p className="max-w-full truncate text-caption text-muted">{l.caption}</p>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" onClick={() => window.print()} disabled={labels.length === 0}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
