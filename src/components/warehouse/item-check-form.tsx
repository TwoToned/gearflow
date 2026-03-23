"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  FileText,
  Ruler,
  ListChecks,
  Camera,
  Loader2,
  ChevronDown,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { getModelCheckItems } from "@/server/check-items";
import { useActiveOrganization } from "@/lib/auth-client";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ──────────────────────────────────────────────────────────────────

type CheckItemType = "PASS_FAIL" | "NOTES" | "MEASUREMENT" | "DROPDOWN";

interface CheckItemData {
  id: string;
  checkItem: {
    id: string;
    label: string;
    description: string | null;
    type: CheckItemType;
    category: string | null;
    measurementUnit: string | null;
    measurementMin: number | null;
    measurementMax: number | null;
    dropdownOptions: Array<{ label: string; isFail: boolean }> | null;
  };
  sortOrder: number;
}

interface CheckState {
  result: "PASS" | "FAIL" | "NOTES_ONLY" | null;
  value: string;
  notes: string;
  photos: string[];
}

export interface ItemCheckFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  assetTag: string;
  assetName: string;
  context: "PREP" | "RETURN" | "AD_HOC";
  onSubmit: (checks: CheckRecordFormValues[]) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  /** Render inline instead of in a Sheet (for ad-hoc check page) */
  embedded?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ItemCheckForm({
  open,
  onOpenChange,
  modelId,
  assetTag,
  assetName,
  context,
  onSubmit,
  onCancel,
  isSubmitting = false,
  embedded = false,
}: ItemCheckFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: modelCheckItems = [], isLoading } = useQuery({
    queryKey: ["model-check-items", orgId, modelId],
    queryFn: () => getModelCheckItems(modelId),
    enabled: open && !!modelId,
  });

  const items = modelCheckItems as unknown as CheckItemData[];

  // Check states — keyed by checkItemId
  const [checkStates, setCheckStates] = useState<Record<string, CheckState>>({});
  const [passAllUndo, setPassAllUndo] = useState<ReturnType<typeof setTimeout> | null>(null);
  const passAllUndoRef = useRef<Record<string, CheckState> | null>(null);

  // Reset states when form opens with new items
  useEffect(() => {
    if (open && items.length > 0) {
      const initial: Record<string, CheckState> = {};
      for (const mci of items) {
        initial[mci.checkItem.id] = {
          result: null,
          value: "",
          notes: "",
          photos: [],
        };
      }
      setCheckStates(initial);
      setPassAllUndo(null);
      passAllUndoRef.current = null;
    }
  }, [open, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCheck = useCallback(
    (checkItemId: string, updates: Partial<CheckState>) => {
      setCheckStates((prev) => ({
        ...prev,
        [checkItemId]: { ...prev[checkItemId], ...updates },
      }));
    },
    []
  );

  // Pass All — sets all unanswered PASS_FAIL items to PASS with 3s undo
  function handlePassAll() {
    const previous = { ...checkStates };
    passAllUndoRef.current = previous;

    const next = { ...checkStates };
    for (const mci of items) {
      if (mci.checkItem.type === "PASS_FAIL" && !next[mci.checkItem.id]?.result) {
        next[mci.checkItem.id] = {
          ...next[mci.checkItem.id],
          result: "PASS",
        };
      }
    }
    setCheckStates(next);

    const timer = setTimeout(() => {
      setPassAllUndo(null);
      passAllUndoRef.current = null;
    }, 3000);
    setPassAllUndo(timer);

    toast.success("All pass/fail items marked as Pass", {
      action: {
        label: "Undo",
        onClick: () => {
          if (passAllUndoRef.current) {
            setCheckStates(passAllUndoRef.current);
          }
          clearTimeout(timer);
          setPassAllUndo(null);
          passAllUndoRef.current = null;
        },
      },
      duration: 3000,
    });
  }

  // Determine auto-result for measurement
  function getMeasurementAutoResult(
    value: string,
    min: number | null,
    max: number | null
  ): "PASS" | "FAIL" | null {
    const num = parseFloat(value);
    if (isNaN(num)) return null;
    if (min !== null && num < min) return "FAIL";
    if (max !== null && num > max) return "FAIL";
    return "PASS";
  }

  // Check if all items have results
  const allComplete = items.every((mci) => {
    const state = checkStates[mci.checkItem.id];
    if (!state) return false;
    if (mci.checkItem.type === "NOTES") return true; // Notes are always optional
    return state.result !== null;
  });

  function handleSubmit() {
    const checks: CheckRecordFormValues[] = items.map((mci) => {
      const state = checkStates[mci.checkItem.id];
      return {
        checkItemId: mci.checkItem.id,
        result: state?.result || "NOTES_ONLY",
        value: state?.value || undefined,
        notes: state?.notes || undefined,
        photos: state?.photos || [],
      };
    });
    onSubmit(checks);
  }

  const failCount = Object.values(checkStates).filter((s) => s.result === "FAIL").length;

  const contextLabel = context === "PREP" ? "Prep Check" : context === "RETURN" ? "Return Check" : "Ad-Hoc Check";
  const submitLabel = context === "PREP"
    ? failCount > 0 ? "Flag Item" : "Pack Item"
    : context === "RETURN"
      ? "Complete Return"
      : "Save Check";

  const formContent = (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-fg-3">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading check items...
        </div>
      ) : (
        <div className={embedded ? "p-4 space-y-1" : "mt-4 space-y-1"}>
          {/* Pass All button */}
          {items.some((mci) => mci.checkItem.type === "PASS_FAIL") && (
            <div className="flex justify-end pb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePassAll}
                className="text-green-600 border-green-600/20 hover:bg-green-600/10"
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Pass All
              </Button>
            </div>
          )}

          {/* Check items */}
          {items.map((mci, index) => (
            <CheckItemRow
              key={mci.checkItem.id}
              item={mci}
              state={checkStates[mci.checkItem.id]}
              index={index}
              onUpdate={(updates) => updateCheck(mci.checkItem.id, updates)}
              getMeasurementAutoResult={getMeasurementAutoResult}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className={`${embedded ? "px-4 pb-4" : "mt-6"} border-t border-border pt-4 space-y-3`}>
        {failCount > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            {failCount} item{failCount !== 1 ? "s" : ""} failed
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            disabled={!allComplete || isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return formContent;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono text-sm text-primary">{assetTag}</span>
            <span className="text-fg-3">—</span>
            <span className="truncate">{assetName}</span>
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {contextLabel}
            </Badge>
            <span className="text-xs text-fg-3">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
          </div>
        </SheetHeader>
        {formContent}
      </SheetContent>
    </Sheet>
  );
}

// ─── Individual Check Item Row ──────────────────────────────────────────────

function CheckItemRow({
  item,
  state,
  index,
  onUpdate,
  getMeasurementAutoResult,
}: {
  item: CheckItemData;
  state: CheckState | undefined;
  index: number;
  onUpdate: (updates: Partial<CheckState>) => void;
  getMeasurementAutoResult: (
    value: string,
    min: number | null,
    max: number | null
  ) => "PASS" | "FAIL" | null;
}) {
  const ci = item.checkItem;
  const result = state?.result;
  const [showNotes, setShowNotes] = useState(false);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        result === "PASS"
          ? "border-green-500/30 bg-green-500/5"
          : result === "FAIL"
            ? "border-destructive/30 bg-destructive/5"
            : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{ci.label}</p>
          {ci.description && (
            <p className="mt-0.5 text-xs text-fg-3">{ci.description}</p>
          )}
        </div>
        <span className="text-[10px] text-fg-3 shrink-0 tabular-nums">
          {index + 1}/{item.sortOrder !== undefined ? "" : ""}
        </span>
      </div>

      <div className="mt-2">
        {ci.type === "PASS_FAIL" && (
          <PassFailInput result={result} onUpdate={onUpdate} />
        )}
        {ci.type === "NOTES" && (
          <NotesInput
            value={state?.notes || ""}
            onChange={(notes) => onUpdate({ notes, result: notes ? "NOTES_ONLY" : null })}
          />
        )}
        {ci.type === "MEASUREMENT" && (
          <MeasurementInput
            value={state?.value || ""}
            unit={ci.measurementUnit}
            min={ci.measurementMin}
            max={ci.measurementMax}
            result={result}
            onChange={(value) => {
              const autoResult = getMeasurementAutoResult(
                value,
                ci.measurementMin,
                ci.measurementMax
              );
              onUpdate({ value, result: autoResult });
            }}
          />
        )}
        {ci.type === "DROPDOWN" && (
          <DropdownInput
            options={ci.dropdownOptions || []}
            value={state?.value || ""}
            onChange={(value, isFail) => {
              onUpdate({
                value,
                result: isFail ? "FAIL" : "PASS",
              });
            }}
          />
        )}
      </div>

      {/* Notes toggle for non-NOTES types */}
      {ci.type !== "NOTES" && (
        <div className="mt-2">
          {showNotes ? (
            <Textarea
              value={state?.notes || ""}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="Add notes..."
              rows={2}
              className="text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-xs text-fg-3 hover:text-fg transition-colors"
            >
              + Add notes
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Input Components ───────────────────────────────────────────────────────

function PassFailInput({
  result,
  onUpdate,
}: {
  result: "PASS" | "FAIL" | "NOTES_ONLY" | null | undefined;
  onUpdate: (updates: Partial<CheckState>) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onUpdate({ result: "FAIL" })}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
          result === "FAIL"
            ? "bg-destructive text-destructive-foreground"
            : "bg-bg-elevated text-fg-3 hover:text-destructive hover:bg-destructive/10"
        }`}
      >
        <XCircle className="h-4 w-4" />
        Fail
      </button>
      <button
        type="button"
        onClick={() => onUpdate({ result: "PASS" })}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${
          result === "PASS"
            ? "bg-green-600 text-white"
            : "bg-bg-elevated text-fg-3 hover:text-green-600 hover:bg-green-600/10"
        }`}
      >
        <CheckCircle2 className="h-4 w-4" />
        Pass
      </button>
    </div>
  );
}

function NotesInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter notes..."
      rows={2}
      className="text-sm"
    />
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
  result: "PASS" | "FAIL" | "NOTES_ONLY" | null | undefined;
  onChange: (value: string) => void;
}) {
  const rangeText = [
    min !== null ? `Min: ${min}` : null,
    max !== null ? `Max: ${max}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value"
          className="flex-1 text-sm"
        />
        {unit && <span className="text-sm text-fg-3 shrink-0">{unit}</span>}
        {result && (
          <Badge
            variant="outline"
            className={
              result === "PASS"
                ? "bg-green-500/10 text-green-500 border-green-500/20"
                : "bg-destructive/10 text-destructive border-destructive/20"
            }
          >
            {result === "PASS" ? "Pass" : "Fail"}
          </Badge>
        )}
      </div>
      {rangeText && (
        <p className="text-[11px] text-fg-3">{rangeText}</p>
      )}
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
        const opt = options.find((o) => o.label === v);
        onChange(v, opt?.isFail ?? false);
      }}
    >
      <SelectTrigger className="text-sm">
        <SelectValue placeholder="Select...">
          {selectedOption ? selectedOption.label : "Select..."}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.label} value={opt.label}>
            <div className="flex items-center gap-2">
              {opt.label}
              {opt.isFail && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 text-destructive border-destructive/20">
                  Fail
                </Badge>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
