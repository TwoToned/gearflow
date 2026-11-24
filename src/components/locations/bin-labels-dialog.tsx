"use client";

import * as React from "react";
import QRCode from "react-qr-code";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface BinLabel {
  id: string;
  name: string;
  printed: boolean;
}

/** The labels to print: the unprinted ones, or all of them (`Print bin labels` offers both). */
export function labelsToPrint(labels: BinLabel[], mode: "unprinted" | "all"): BinLabel[] {
  return mode === "all" ? labels : labels.filter((l) => !l.printed);
}

/** Which labels print: the mode, the counts, and the chosen set (nothing unprinted means "unprinted only" would print nothing: show all). */
function usePrintChoice(labels: BinLabel[] | null) {
  const [mode, setMode] = React.useState<"unprinted" | "all">("unprinted");
  const unprinted = labels?.filter((l) => !l.printed).length ?? 0;
  const chosen = labels ? labelsToPrint(labels, unprinted === 0 ? "all" : mode) : [];
  return { mode, setMode, unprinted, total: labels?.length ?? 0, chosen };
}

function ModeChoice({ mode, onChange, unprinted, all }: { mode: "unprinted" | "all"; onChange: (m: "unprinted" | "all") => void; unprinted: number; all: number }) {
  return (
    <div className="flex gap-4 text-ui-text" role="radiogroup" aria-label="Which labels">
      {(["unprinted", "all"] as const).map((m) => (
        <label key={m} className="flex items-center gap-2">
          <input type="radio" name="bin-label-mode" checked={mode === m} onChange={() => onChange(m)} />
          {m === "unprinted" ? `Unprinted only (${unprinted})` : `All (${all})`}
        </label>
      ))}
    </div>
  );
}

/**
 * `Print bin labels` (print only for now, owner ruling 2026-11-24): a sheet of labels, each the location's
 * name and a QR code of its page address (a phone camera opens it). Printing stamps `labelPrintedAt` on
 * exactly the locations printed; there is no Undo: a reprint is the correction.
 */
export function BinLabelsDialog({
  labels,
  origin,
  onClose,
  onPrinted,
}: {
  /** Null = closed. */
  labels: BinLabel[] | null;
  origin: string;
  onClose: () => void;
  onPrinted: (ids: string[]) => Promise<void>;
}) {
  const { mode, setMode, unprinted, total, chosen } = usePrintChoice(labels);

  const print = async () => {
    window.print();
    await onPrinted(chosen.map((l) => l.id));
    onClose();
  };

  return (
    <Dialog open={labels !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Print bin labels</DialogTitle>
          <DialogDescription>
            {total} selected · {unprinted} not yet printed. Each label carries the location&apos;s name and a QR code of its page.
          </DialogDescription>
        </DialogHeader>
        {unprinted > 0 && unprinted < total && <ModeChoice mode={mode} onChange={setMode} unprinted={unprinted} all={total} />}
        <div id="bin-labels-sheet" className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {chosen.map((l) => (
            <div key={l.id} className="flex flex-col items-center gap-2 rounded-[var(--r)] border border-line-2 bg-white p-3 text-center text-black">
              <QRCode value={`${origin}/locations/${l.id}`} size={96} />
              <p className="t-mono text-sm font-medium">{l.name}</p>
            </div>
          ))}
        </div>
        <style>{`@media print { body * { visibility: hidden !important; } #bin-labels-sheet, #bin-labels-sheet * { visibility: visible !important; } #bin-labels-sheet { position: absolute; inset: 0; max-height: none !important; overflow: visible !important; } }`}</style>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void print()} disabled={chosen.length === 0}>
            <Printer className="mr-2 h-4 w-4" />
            Print {chosen.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
