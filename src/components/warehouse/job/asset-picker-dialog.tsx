"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { countAssigned } from "@/lib/asset-picker-scan";
import type { AssetPicker } from "./use-asset-picker";
import type { PickerRow } from "./job-types";

const assetLabel = (a: PickerRow["availableAssets"][number]) => `${a.assetTag}${a.customName ? ` — ${a.customName}` : ""}`;

function PickerSlot({ row, idx, rows, onPick }: { row: PickerRow; idx: number; rows: PickerRow[]; onPick: (assetId: string) => void }) {
  const sameLine = rows.filter((i) => i.lineItemId === row.lineItemId);
  const ordinal = sameLine.length > 1 ? ` #${rows.filter((i, j) => i.lineItemId === row.lineItemId && j <= idx).length}` : "";
  const taken = new Set(rows.filter((_, i) => i !== idx).map((i) => i.selectedAssetId));
  const selected = row.availableAssets.find((x) => x.id === row.selectedAssetId);
  return (
    <div className="space-y-1.5">
      <Label className="text-ui-text font-medium">{row.modelName}{ordinal}</Label>
      {row.availableAssets.length === 0 ? (
        <p className="text-ui-text text-t-out">No available assets</p>
      ) : (
        <Select value={row.selectedAssetId} onValueChange={(val) => onPick(val ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder="Select an asset...">
              {row.selectedAssetId ? (selected ? assetLabel(selected) : row.selectedAssetId) : "Select an asset..."}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {row.availableAssets.filter((a) => !taken.has(a.id)).map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {assetLabel(asset)}{asset.serialNumber ? ` (S/N: ${asset.serialNumber})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * "Assign assets": scan each unit as it is picked (continuous, so the camera stays open for the
 * eleven-headsets pass) or choose from the dropdowns. The scan field is sticky: eleven slots scroll
 * the field out of view exactly when it is used every few seconds.
 */
export function AssetPickerDialog({ picker }: { picker: AssetPicker }) {
  const { items } = picker;
  return (
    <Dialog open={picker.open} onOpenChange={picker.setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign assets</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-ui-text text-muted">Scan each unit as you pick it, or choose from the dropdowns.</p>
          <div className="sticky top-0 z-10 -mx-6 space-y-1.5 border-b border-line bg-elev px-6 pb-3">
            <AssetTagInput
              value={picker.scanValue}
              onChange={(e) => picker.setScanValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); picker.handleScan(picker.scanValue); } }}
              onScan={picker.handleScan}
              scannerTitle="Scan to assign"
              continuous
              placeholder="Scan an asset tag to assign it..."
              className="h-11 font-mono"
              autoFocus
            />
            <p className="text-ui-text text-muted" aria-live="polite">{countAssigned(items)} of {items.length} assigned</p>
          </div>
          {items.map((row, idx) => (
            <PickerSlot
              key={`${row.lineItemId}-${idx}`} row={row} idx={idx} rows={items}
              onPick={(assetId) => picker.applyItems((prev) => prev.map((item, i) => (i === idx ? { ...item, selectedAssetId: assetId } : item)))}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => picker.setOpen(false)}>Cancel</Button>
          <Button onClick={picker.confirm} disabled={items.some((i) => !i.selectedAssetId)}>Prep</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
