"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import {
  measurementAutoResult,
  type CheckItemData,
  type CheckResult,
  type CheckState,
  type CheckStates,
} from "@/lib/check-item-state";
import { focusRing } from "@/lib/utils";
import { CHECK_PHOTO_FOLDER } from "../../../convex/lib/checkPhotos";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * The item list of a checklist: one row per check item (Pass/Fail words, a
 * measurement with its derived verdict, a dropdown whose `isFail` options fail, a
 * notes item, a per-item note) and, on a FAIL, the required reason + photo block
 * (#898). Extracted from `ItemCheckForm` so the warehouse check sheet and the Scan
 * page's inline Check form render the SAME rows (spec §9i.7). Controlled: the
 * owner keeps the states and decides when the list is complete
 * (`src/lib/check-item-state.ts`).
 */
export function CheckItemFields({
  items,
  states,
  onUpdate,
  focusedRowIndex = null,
  onFocusRow,
  onFailPhotoUploadingChange,
}: {
  items: CheckItemData[];
  states: CheckStates;
  onUpdate: (checkItemId: string, updates: Partial<CheckState>) => void;
  /** The keyboard cursor's row (the warehouse sheet's P/F hotkeys); `null` = none. */
  focusedRowIndex?: number | null;
  onFocusRow?: (index: number) => void;
  /** FAIL photo upload state, so the owner can hold the save mid-upload. Must be stable. */
  onFailPhotoUploadingChange?: (checkItemId: string, uploading: boolean) => void;
}) {
  return (
    <>
      {items.map((mci, index) => (
        <CheckItemRow
          key={mci.checkItem.id}
          item={mci}
          state={states[mci.checkItem.id]}
          index={index}
          isFocused={index === focusedRowIndex && mci.checkItem.type === "PASS_FAIL"}
          onFocus={onFocusRow ? () => onFocusRow(index) : undefined}
          onUpdate={(updates) => onUpdate(mci.checkItem.id, updates)}
          onFailPhotoUploadingChange={onFailPhotoUploadingChange}
        />
      ))}
    </>
  );
}

function rowTone(result: CheckResult | null | undefined): string {
  if (result === "PASS") return "border-ok/40 bg-ok-soft/50";
  if (result === "FAIL") return "border-t-out/40 bg-out-soft/60";
  return "border-line";
}

function CheckItemRow({
  item,
  state,
  index,
  isFocused,
  onFocus,
  onUpdate,
  onFailPhotoUploadingChange,
}: {
  item: CheckItemData;
  state: CheckState | undefined;
  index: number;
  isFocused: boolean;
  onFocus?: () => void;
  onUpdate: (updates: Partial<CheckState>) => void;
  onFailPhotoUploadingChange?: (checkItemId: string, uploading: boolean) => void;
}) {
  const ci = item.checkItem;
  const result = state?.result;
  const isFail = result === "FAIL";
  // Bind the checkItemId once per row so the reference PhotoGridInput depends on
  // stays stable across re-renders (its `[pending, onUploadingChange]` effect would
  // otherwise re-fire on every parent render).
  const handleFailPhotoUploadingChange = useCallback(
    (uploading: boolean) => onFailPhotoUploadingChange?.(ci.id, uploading),
    [onFailPhotoUploadingChange, ci.id],
  );

  return (
    <div
      onClick={onFocus}
      data-check-item={ci.id}
      className={`rounded-[var(--r)] border-2 p-3 transition-colors ${
        isFocused ? "ring-2 ring-red ring-offset-2 ring-offset-paper" : ""
      } ${rowTone(result)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ui-text font-medium text-ink">{ci.label}</p>
          {ci.description && <p className="mt-0.5 text-caption text-muted">{ci.description}</p>}
        </div>
        <span className="text-micro text-muted shrink-0 tabular-nums">{index + 1}</span>
      </div>

      <div className="mt-2">
        <ItemInput item={item} state={state} onUpdate={onUpdate} />
      </div>

      {isFail && <FailBlock state={state} onUpdate={onUpdate} onUploadingChange={handleFailPhotoUploadingChange} />}

      {ci.type !== "NOTES" && !isFail && <ItemNote notes={state?.notes || ""} onChange={(notes) => onUpdate({ notes })} />}
    </div>
  );
}

function ItemInput({
  item,
  state,
  onUpdate,
}: {
  item: CheckItemData;
  state: CheckState | undefined;
  onUpdate: (updates: Partial<CheckState>) => void;
}) {
  const ci = item.checkItem;
  const s = state ?? EMPTY_STATE;
  if (ci.type === "PASS_FAIL") return <PassFailInput result={s.result} onUpdate={onUpdate} />;
  if (ci.type === "NOTES") {
    return (
      <Textarea
        value={s.notes}
        onChange={(e) => onUpdate({ notes: e.target.value, result: e.target.value ? "NOTES_ONLY" : null })}
        placeholder="Enter notes..."
        rows={2}
        className={FIELD_TEXT}
      />
    );
  }
  if (ci.type === "MEASUREMENT") {
    return (
      <MeasurementInput
        value={s.value}
        unit={ci.measurementUnit}
        min={ci.measurementMin}
        max={ci.measurementMax}
        result={s.result}
        onChange={(value) => onUpdate({ value, result: measurementAutoResult(value, ci.measurementMin, ci.measurementMax) })}
      />
    );
  }
  return <DropdownInput options={ci.dropdownOptions ?? []} value={s.value} onChange={(value, isFail) => onUpdate({ value, result: isFail ? "FAIL" : "PASS" })} />;
}

const EMPTY_STATE: CheckState = { result: null, value: "", notes: "", photos: [] };
/** 16 px on a phone (no iOS zoom on focus), the table size from `md` up. */
const FIELD_TEXT = "text-reading-body md:text-ui-text";

/** FAIL: the inline "what happened?" reason + photo, required before the save (#898). */
function FailBlock({
  state,
  onUpdate,
  onUploadingChange,
}: {
  state: CheckState | undefined;
  onUpdate: (updates: Partial<CheckState>) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-[var(--r)] border-l-[3px] border-l-t-out bg-out-soft/40 p-2.5">
      <p className="text-caption font-medium text-t-out">What happened? (required)</p>
      <Textarea
        value={state?.notes || ""}
        onChange={(e) => onUpdate({ notes: e.target.value })}
        placeholder="Describe the failure..."
        rows={2}
        className={FIELD_TEXT}
      />
      <PhotoGridInput
        value={state?.photos || []}
        onChange={(photos) => onUpdate({ photos })}
        onUploadingChange={onUploadingChange}
        compact
        maxPhotos={6}
        // An ad-hoc check only accepts photos uploaded into this folder (convex/lib/checkPhotos.ts).
        folder={CHECK_PHOTO_FOLDER}
      />
      {(state?.photos.length ?? 0) === 0 && <p className="text-micro text-t-out">At least one photo is required.</p>}
    </div>
  );
}

/** The per-item note, behind `+ Add notes` until opened or filled. */
function ItemNote({ notes, onChange }: { notes: string; onChange: (notes: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-2">
      {show || notes ? (
        <Textarea value={notes} onChange={(e) => onChange(e.target.value)} placeholder="Add notes..." rows={2} className={FIELD_TEXT} />
      ) : (
        <button
          type="button"
          onClick={() => setShow(true)}
          className={`inline-flex min-h-11 items-center rounded-[var(--r)] px-3 text-caption text-muted transition-colors hover:text-ink ${focusRing}`}
        >
          + Add notes
        </button>
      )}
    </div>
  );
}

function PassFailInput({
  result,
  onUpdate,
}: {
  result: CheckResult | null | undefined;
  onUpdate: (updates: Partial<CheckState>) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onUpdate({ result: "FAIL" })}
        aria-pressed={result === "FAIL"}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-[var(--r)] py-2 min-h-11 text-ui-text font-medium transition-colors ${focusRing} ${
          result === "FAIL" ? "bg-out-soft text-t-out ring-1 ring-t-out/50" : "bg-elev text-muted hover:text-t-out hover:bg-out-soft"
        }`}
      >
        <XCircle className="h-4 w-4" />
        Fail
      </button>
      <button
        type="button"
        onClick={() => onUpdate({ result: "PASS" })}
        aria-pressed={result === "PASS"}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-[var(--r)] py-2 min-h-11 text-ui-text font-medium transition-colors ${focusRing} ${
          result === "PASS" ? "bg-ok text-dark" : "bg-elev text-muted hover:text-ok hover:bg-ok-soft"
        }`}
      >
        <CheckCircle2 className="h-4 w-4" />
        Pass
      </button>
    </div>
  );
}

function MeasurementInput({
  value,
  unit,
  min,
  max,
  result,
  onChange,
}: {
  value: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  result: CheckResult | null | undefined;
  onChange: (value: string) => void;
}) {
  const rangeText = [min !== null ? `Min: ${min}` : null, max !== null ? `Max: ${max}` : null].filter(Boolean).join(" · ");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value"
          className={`flex-1 font-mono ${FIELD_TEXT}`}
        />
        {unit && <span className="text-ui-text text-muted shrink-0">{unit}</span>}
        {result && <Badge status={result === "PASS" ? "ok" : "overbooked"}>{result === "PASS" ? "Pass" : "Fail"}</Badge>}
      </div>
      {rangeText && <p className="text-micro text-muted">{rangeText}</p>}
    </div>
  );
}

function DropdownInput({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; isFail: boolean }>;
  value: string;
  onChange: (value: string, isFail: boolean) => void;
}) {
  const selectedOption = options.find((o) => o.label === value);
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (!v) return;
        const opt = options.find((o) => o.label === v);
        onChange(v, opt?.isFail ?? false);
      }}
    >
      <SelectTrigger className={FIELD_TEXT}>
        <SelectValue placeholder="Select...">{selectedOption ? selectedOption.label : "Select..."}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.label} value={opt.label}>
            <div className="flex items-center gap-2">
              {opt.label}
              {opt.isFail && <Badge status="overbooked">Fail</Badge>}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
