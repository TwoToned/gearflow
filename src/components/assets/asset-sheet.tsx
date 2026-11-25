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
  /** `again` = `Save and add another` (the sheet stays open); otherwise the sheet closes after this. */
  onSaved?: (r: { id: string; kind: "serialized" | "bulk"; again?: boolean }) => void;
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

type Created = Extract<AssetSheetState, { mode: "create" }>;
type Saved = NonNullable<AssetSheetProps["onSaved"]>;

/** Tells a sheet's `onSaved` which kind it saved. */
const asKind = (kind: "serialized" | "bulk", onSaved: Saved | undefined) =>
  onSaved && ((r: { id: string; again?: boolean }) => onSaved({ ...r, kind }));

function EditSheet({ state, onClose, onSaved }: { state: Extract<AssetSheetState, { mode: "edit" }>; onClose: () => void; onSaved?: Saved }) {
  if (state.kind === "bulk") return <BulkStockSheet key={state.values.id} mode="edit" values={state.values} onClose={onClose} onSaved={asKind("bulk", onSaved)} />;
  return <SerialisedSheet key={state.values.id} mode="edit" values={state.values} onClose={onClose} onSaved={asKind("serialized", onSaved)} />;
}

/** Create owns the words' choice: a re-open starts on the kind the caller asked for. */
function CreateSheet({ state, onClose, onSaved, onImportCsv }: { state: Created; onClose: () => void; onSaved?: Saved; onImportCsv?: () => void }) {
  const [kind, setKind] = useState(state.kind);
  const d = state.defaults ?? {};
  // The model preset belongs to the kind the caller asked for; the other kind starts empty.
  const modelId = kind === state.kind ? (d.modelId ?? "") : "";
  const common = { mode: "create" as const, onClose, onImportCsv, words: <KindWords kind={kind} onChange={setKind} /> };
  if (kind === "bulk") {
    return <BulkStockSheet key="create-bulk" {...common} values={{ ...BULK_DEFAULTS, modelId, locationId: d.locationId ?? "" }} onSaved={asKind("bulk", onSaved)} />;
  }
  return (
    <SerialisedSheet
      key="create-serialised"
      {...common}
      values={{ ...SERIALISED_DEFAULTS, modelId, locationId: d.locationId ?? "", condition: d.condition ?? "NEW", supplierId: d.supplierId ?? "" }}
      onSaved={asKind("serialized", onSaved)}
    />
  );
}

export function AssetSheet({ state, onClose, onSaved, onImportCsv }: AssetSheetProps) {
  if (!state) return null;
  if (state.mode === "edit") return <EditSheet state={state} onClose={onClose} onSaved={onSaved} />;
  return <CreateSheet state={state} onClose={onClose} onSaved={onSaved} onImportCsv={onImportCsv} />;
}
