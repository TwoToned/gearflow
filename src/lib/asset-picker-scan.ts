/**
 * Scan resolution for the warehouse "Assign assets" dialog.
 *
 * That dialog asks the operator to choose a specific serialised asset for each
 * unit of a multi-quantity line — eleven headsets means eleven dropdowns. A
 * packer holding the gear already knows which one they picked up, so scanning
 * its tag should fill the next slot that can take it.
 *
 * The resolution is pure so the four outcomes can be tested without a camera,
 * a dialog, or a Convex round trip. The component does nothing but apply the
 * result and play the matching feedback.
 */

import { normaliseScannedValue } from "@/lib/barcode/formats";

/** The subset of the dialog's picker rows this resolver needs. */
export interface PickerSlot {
  modelName: string;
  availableAssets: ReadonlyArray<{ id: string; assetTag: string }>;
  /** Empty string when nothing is chosen yet — the dialog's own representation. */
  selectedAssetId: string;
}

export type PickerScanResult =
  /** Filled slot `index` with this asset. */
  | { kind: "assigned"; index: number; assetId: string; assetTag: string; modelName: string }
  /** The tag is already sitting in slot `index` — a re-scan, not a mistake. */
  | { kind: "already-assigned"; index: number; assetTag: string; modelName: string }
  /** The tag belongs to a model in this dialog, but every slot for it is taken. */
  | { kind: "no-slot"; assetTag: string; modelName: string }
  /** Not an available asset for anything in this dialog. */
  | { kind: "unknown"; assetTag: string };

/**
 * Resolve a scanned tag against the dialog's slots.
 *
 * Matching is case-insensitive: printed labels and HID wedges disagree about
 * case often enough that a case-sensitive miss would read as a broken scanner.
 *
 * The order of the checks matters. "Already assigned" is decided BEFORE looking
 * for an empty slot, so re-scanning gear you've already logged tells you where
 * it went instead of silently doing nothing — during a head-down pick of eleven
 * identical headsets, "did that one register?" is the question being asked.
 */
export function resolvePickerScan(
  slots: ReadonlyArray<PickerSlot>,
  rawTag: string,
): PickerScanResult {
  const tag = normaliseScannedValue(rawTag);
  if (!tag) return { kind: "unknown", assetTag: rawTag.trim() };

  const matches = (assetTag: string) => assetTag.toLowerCase() === tag.toLowerCase();

  // 1. Already chosen somewhere? Report where, don't reassign.
  const takenIndex = slots.findIndex((slot) =>
    slot.availableAssets.some((a) => a.id === slot.selectedAssetId && matches(a.assetTag)),
  );
  if (takenIndex !== -1) {
    const slot = slots[takenIndex]!;
    const asset = slot.availableAssets.find((a) => a.id === slot.selectedAssetId)!;
    return { kind: "already-assigned", index: takenIndex, assetTag: asset.assetTag, modelName: slot.modelName };
  }

  // 2. First empty slot that can take it.
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index]!;
    if (slot.selectedAssetId) continue;
    const asset = slot.availableAssets.find((a) => matches(a.assetTag));
    if (asset) {
      return { kind: "assigned", index, assetId: asset.id, assetTag: asset.assetTag, modelName: slot.modelName };
    }
  }

  // 3. Known to the dialog, but every slot that could hold it is full. Distinct
  //    from "unknown" because the operator needs to hear "you've got enough of
  //    those", not "that tag is wrong".
  const fullSlot = slots.find((slot) => slot.availableAssets.some((a) => matches(a.assetTag)));
  if (fullSlot) {
    const asset = fullSlot.availableAssets.find((a) => matches(a.assetTag))!;
    return { kind: "no-slot", assetTag: asset.assetTag, modelName: fullSlot.modelName };
  }

  return { kind: "unknown", assetTag: tag };
}

/** How many slots are filled — drives the dialog's progress line. */
export function countAssigned(slots: ReadonlyArray<PickerSlot>): number {
  return slots.filter((slot) => slot.selectedAssetId).length;
}
