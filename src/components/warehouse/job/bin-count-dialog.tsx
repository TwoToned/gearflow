"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** The count of a bulk bin that is a valid de-prep, or null (whole numbers, 1..remaining). */
export function validBinCount(raw: string, remaining: number): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= remaining ? n : null;
}

/** D8: a bulk bin barcode identifies the bin, so the packer counts how many came back. */
export function BinCountDialog({
  name, remaining, onConfirm, onCancel,
}: {
  name: string;
  remaining: number;
  onConfirm: (count: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(remaining));
  const count = validBinCount(value, remaining);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>How many {name} came back?</DialogTitle>
          <DialogDescription>{remaining} waiting to be de-prepped.</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Count" type="number" inputMode="numeric" min={1} max={remaining} value={value} autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && count) onConfirm(count); }}
          className="h-11 text-base"
        />
        <DialogFooter>
          <Button variant="line" onClick={onCancel}>Cancel</Button>
          <Button disabled={count === null} onClick={() => count && onConfirm(count)}>De-prep {count ?? ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
