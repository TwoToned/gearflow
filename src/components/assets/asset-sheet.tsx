"use client";

import { useState } from "react";

import type { AssetFormValues, BulkAssetFormValues } from "@/lib/validations/asset";
import { cn } from "@/lib/utils";
import { SerialisedSheet } from "./asset-sheet-serialised";
import { BulkStockSheet } from "./asset-sheet-bulk";

/**
 * `AssetSheet` (UX Phase 12, §9d.4, D62/D63): the ONE create and edit surface for
 * assets, on `FormSheet`. It replaces `asset-form`, `bulk-asset-form` and their
 * `/new` + `/edit` pages (which now redirect here). Create offers the words
 * `Serialised unit · Bulk stock` (D63); edit opens the kind the record is.
 */
export type AssetSheetState =
  | { mode: "edit"; kind: "serialized"; values: AssetFormValues & { id: string } }
  | { mode: "edit"; kind: "bulk"; values: BulkAssetFormValues & { id: string } }
  | {
      mode: "create";
      kind: "serialized" | "bulk";
      /** Prefill: a model's `New asset`, `New asset like this…`. Never a serial or a tag. */
      defaults?: { modelId?: string; locationId?: string; condition?: AssetFormValues["condition"]; supplierId?: string };
    };

export interface AssetSheetProps {
  state: AssetSheetState | null;
  onClose: () => void;
  onSaved?: (r: { id: string; kind: "serialized" | "bulk" }) => void;
  onImportCsv?: () => void;
}

const SERIALISED_DEFAULTS: AssetFormValues = {
  modelId: "", assetTag: "", serialNumber: "", customName: "", status: "AVAILABLE", condition: "NEW",
  notes: "", locationId: "", isActive: true, images: [], tags: [],
};
const BULK_DEFAULTS: BulkAssetFormValues = { modelId: "", assetTag: "", status: "ACTIVE", notes: "", locationId: "", isActive: true, tags: [] };

/** `Serialised unit  Bulk stock`: words, the active one underlined (never a segmented control). */
function KindWords({ kind, onChange }: { kind: "serialized" | "bulk"; onChange: (k: "serialized" | "bulk") => void }) {
  const word = (k: "serialized" | "bulk", label: string) => (
    <button
      type="button"
      aria-pressed={kind === k}
      onClick={() => onChange(k)}
      className={cn("min-h-11 border-b-2 pb-0.5 text-table-cell md:min-h-9", kind === k ? "border-red font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-5" role="group" aria-label="What are you adding?">
      {word("serialized", "Serialised unit")}
      {word("bulk", "Bulk stock")}
    </div>
  );
}

export function AssetSheet({ state, onClose, onSaved, onImportCsv }: AssetSheetProps) {
  // Create only: the words can switch kind. Keyed by the opened state so a re-open starts fresh.
  const [picked, setPicked] = useState<"serialized" | "bulk" | null>(null);
  if (!state) return null;
  const creating = state.mode === "create";
  const kind = creating ? (picked ?? state.kind) : state.kind;
  const words = creating ? <KindWords kind={kind} onChange={setPicked} /> : undefined;
  const close = () => {
    setPicked(null);
    onClose();
  };

  if (state.mode === "edit" && state.kind === "serialized") {
    return <SerialisedSheet key={state.values.id} mode="edit" values={state.values} onClose={close} onSaved={onSaved && ((r) => onSaved({ ...r, kind: "serialized" }))} />;
  }
  if (state.mode === "edit") {
    return <BulkStockSheet key={state.values.id} mode="edit" values={state.values} onClose={close} onSaved={onSaved && ((r) => onSaved({ ...r, kind: "bulk" }))} />;
  }
  const d = state.defaults ?? {};
  return kind === "bulk" ? (
    <BulkStockSheet
      key="create-bulk"
      mode="create"
      values={{ ...BULK_DEFAULTS, modelId: kind === state.kind ? (d.modelId ?? "") : "", locationId: d.locationId ?? "" }}
      onClose={close}
      onSaved={onSaved && ((r) => onSaved({ ...r, kind: "bulk" }))}
      onImportCsv={onImportCsv}
      words={words}
    />
  ) : (
    <SerialisedSheet
      key="create-serialised"
      mode="create"
      values={{ ...SERIALISED_DEFAULTS, modelId: kind === state.kind ? (d.modelId ?? "") : "", locationId: d.locationId ?? "", condition: d.condition ?? "NEW", supplierId: d.supplierId ?? "" }}
      onClose={close}
      onSaved={onSaved && ((r) => onSaved({ ...r, kind: "serialized" }))}
      onImportCsv={onImportCsv}
      words={words}
    />
  );
}
