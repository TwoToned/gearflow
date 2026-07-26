"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";
import { cn, focusRing } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
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
  /** Model ID — used to fetch model check items. Provide either modelId or kitId. */
  modelId?: string;
  /** Kit ID — used to fetch kit-level check items (KIT_LEVEL mode). */
  kitId?: string;
  assetTag: string;
  assetName: string;
  context: "PREP" | "RETURN" | "AD_HOC";
  onSubmit: (checks: CheckRecordFormValues[], returnInfo?: { condition: "GOOD" | "DAMAGED" | "MISSING"; notes?: string }) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  /** Render inline instead of in a Sheet (for ad-hoc check page) */
  embedded?: boolean;
  /** Queue position (1-based) when processing multiple items */
  queuePosition?: number;
  /** Total items in queue */
  queueTotal?: number;
  /** Callback to pass all remaining items in the queue */
  onPassAllRemaining?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ItemCheckForm({
  open,
  onOpenChange,
  modelId,
  kitId,
  assetTag,
  assetName,
  context,
  onSubmit,
  onCancel,
  isSubmitting = false,
  embedded = false,
  queuePosition,
  queueTotal,
  onPassAllRemaining,
}: ItemCheckFormProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();

  const { data: modelCheckItems = [], isLoading } = useServerQuery<unknown[]>({
    // isAuthenticated is in the key so the query re-runs once Convex auth is ready
    // (useServerQuery won't otherwise retry a read that ran before auth settled).
    queryKey: kitId ? ["kit-check-items", orgId, kitId, isAuthenticated] : ["model-check-items", orgId, modelId, isAuthenticated],
    queryFn: () =>
      (kitId
        ? convex.query(api.kitCheckItems.assignmentsForKit, { orgId: orgId!, kitId })
        : convex.query(api.modelCheckItems.assignmentsForModel, { orgId: orgId!, modelId: modelId! })) as Promise<unknown[]>,
    enabled: open && !!orgId && isAuthenticated && !!(modelId || kitId),
  });

  const items = modelCheckItems as unknown as CheckItemData[];

  // Check states — keyed by checkItemId
  const [checkStates, setCheckStates] = useState<Record<string, CheckState>>({});
  const [passAllUndo, setPassAllUndo] = useState<ReturnType<typeof setTimeout> | null>(null);
  const passAllUndoRef = useRef<Record<string, CheckState> | null>(null);

  // Return condition state (only used when context === "RETURN")
  const [returnCondition, setReturnCondition] = useState<"GOOD" | "DAMAGED" | "MISSING">("GOOD");
  const [returnNotes, setReturnNotes] = useState("");

  // Keyboard-shortcut cursor: which row is "active" for P/F keystrokes.
  // Points at an index within the full items[] array — arrow keys skip non-PASS_FAIL rows.
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);

  // Inline FAIL reason/photo capture (GitHub #898 — "checks that actually do
  // something"): a FAILed row must carry a reason (notes) + at least one photo
  // before the check can submit. Uploading state is tracked per checkItemId so
  // submit stays disabled while any FAIL row's photo is still uploading.
  const [failPhotosUploading, setFailPhotosUploading] = useState<Record<string, boolean>>({});
  const anyFailPhotoUploading = Object.values(failPhotosUploading).some(Boolean);
  // Stable across renders (empty deps — setFailPhotosUploading never changes) so
  // PhotoGridInput's `[pending, onUploadingChange]` effect only re-fires when
  // upload state genuinely changes, not on every parent render — an inline arrow
  // here would recreate on every render and loop forever.
  const updateFailPhotoUploading = useCallback((checkItemId: string, uploading: boolean) => {
    setFailPhotosUploading((prev) => ({ ...prev, [checkItemId]: uploading }));
  }, []);

  // Refs used by the keyboard handler so it reads the latest props/state without re-binding.
  const handleSubmitRef = useRef<() => void>(() => {});
  const handlePassAllRef = useRef<() => void>(() => {});
  const stateRef = useRef<{
    items: CheckItemData[];
    checkStates: Record<string, CheckState>;
    focusedRowIndex: number;
    isSubmitting: boolean;
    isLoading: boolean;
  }>({
    items: [],
    checkStates: {},
    focusedRowIndex: 0,
    isSubmitting: false,
    isLoading: false,
  });

  // Clear any pending pass-all undo timer on unmount or when the form closes,
  // so a stale timeout doesn't fire setState after the component is gone.
  useEffect(() => {
    if (!open && passAllUndo) {
      clearTimeout(passAllUndo);
      setPassAllUndo(null);
      passAllUndoRef.current = null;
    }
    return () => {
      if (passAllUndo) clearTimeout(passAllUndo);
    };
  }, [open, passAllUndo]);

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
      setReturnCondition("GOOD");
      setReturnNotes("");
      // Land the keyboard cursor on the first PASS_FAIL row if there is one, else row 0
      const firstPassFail = items.findIndex((mci) => mci.checkItem.type === "PASS_FAIL");
      setFocusedRowIndex(firstPassFail >= 0 ? firstPassFail : 0);
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

  // Check if all items have results.
  // The `items.length > 0` guard matters: Array.prototype.every returns true for an
  // empty array, which would make allComplete true (a) while the check-items query is
  // still loading and (b) for a model/kit with zero configured checks. Either case
  // lets the user submit an empty checks[] array, which the server's `.min(1)` Zod
  // schema rejects with an uncaught ZodError → 500. Items with no checks are meant to
  // go through prepItemDirect, not this form.
  const allComplete = items.length > 0 && items.every((mci) => {
    const state = checkStates[mci.checkItem.id];
    if (!state) return false;
    if (mci.checkItem.type === "NOTES") return true; // Notes are always optional
    if (state.result === "FAIL") {
      // FAIL requires an inline "what happened" reason + at least one photo
      // before the check can submit — the reason a genuine failure opens a
      // maintenance record (checkIncidentReportCore.ts) instead of a silent flag.
      return state.notes.trim().length > 0 && state.photos.length > 0;
    }
    return state.result !== null;
  }) && !anyFailPhotoUploading;

  function handleSubmit() {
    if (!allComplete || isSubmitting) return;
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

    if (context === "RETURN") {
      // Auto-override condition to DAMAGED if any checks failed
      const effectiveCondition = failCount > 0 ? "DAMAGED" : returnCondition;
      onSubmit(checks, {
        condition: effectiveCondition,
        notes: returnNotes || undefined,
      });
    } else {
      onSubmit(checks);
    }
  }

  const failCount = Object.values(checkStates).filter((s) => s.result === "FAIL").length;

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  // P / F         — pass or fail the focused PASS_FAIL row
  // A             — pass all remaining PASS_FAIL rows (same as the existing button)
  // ArrowUp/Down  — move the focused row cursor, skipping non-PASS_FAIL rows
  // Enter         — submit if all complete
  // Guards: ignore when any text input/textarea/select/contenteditable has focus,
  //         and when the form is submitting or loading.
  // Latest-value refs avoid re-binding the keydown listener on every state tick.
  // Assigning during render trips react-hooks/refs (React Compiler), so sync the
  // refs in an effect with no deps array — it runs after every commit, and the
  // listener only reads `.current` at event time, so post-commit freshness is
  // sufficient.
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
    handlePassAllRef.current = handlePassAll;
    stateRef.current = { items, checkStates, focusedRowIndex, isSubmitting, isLoading };
  });

  useEffect(() => {
    if (!open || embedded) return;

    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      const s = stateRef.current;
      if (s.isSubmitting || s.isLoading) return;
      // Modifier keys → let the browser handle (e.g. Cmd+R)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't hijack while the user is typing in a notes/measurement/dropdown field
      if (isTypingTarget(e.target)) return;

      const key = e.key;
      const passFailIndices = s.items
        .map((mci, i) => (mci.checkItem.type === "PASS_FAIL" ? i : -1))
        .filter((i) => i >= 0);

      if (key === "p" || key === "P" || key === "f" || key === "F") {
        const focusedItem = s.items[s.focusedRowIndex];
        if (!focusedItem || focusedItem.checkItem.type !== "PASS_FAIL") return;
        const result = key === "p" || key === "P" ? "PASS" : "FAIL";
        e.preventDefault();
        setCheckStates((prev) => ({
          ...prev,
          [focusedItem.checkItem.id]: { ...prev[focusedItem.checkItem.id], result },
        }));
        // Auto-advance to next PASS_FAIL row
        const currentPos = passFailIndices.indexOf(s.focusedRowIndex);
        if (currentPos >= 0 && currentPos + 1 < passFailIndices.length) {
          setFocusedRowIndex(passFailIndices[currentPos + 1]);
        }
        return;
      }

      if (key === "a" || key === "A") {
        if (passFailIndices.length === 0) return;
        e.preventDefault();
        handlePassAllRef.current();
        return;
      }

      if (key === "ArrowDown" || key === "ArrowUp") {
        if (passFailIndices.length === 0) return;
        e.preventDefault();
        const currentPos = passFailIndices.indexOf(s.focusedRowIndex);
        if (key === "ArrowDown") {
          const next = currentPos < 0 ? 0 : Math.min(currentPos + 1, passFailIndices.length - 1);
          setFocusedRowIndex(passFailIndices[next]);
        } else {
          const next = currentPos < 0 ? passFailIndices.length - 1 : Math.max(currentPos - 1, 0);
          setFocusedRowIndex(passFailIndices[next]);
        }
        return;
      }

      if (key === "Enter") {
        e.preventDefault();
        handleSubmitRef.current();
        return;
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, embedded]);

  const contextLabel = context === "PREP" ? "Prep check" : context === "RETURN" ? "Return check" : "Ad-hoc check";
  const submitLabel = context === "PREP"
    ? failCount > 0 ? "Flag item" : "Pack item"
    : context === "RETURN"
      ? failCount > 0 ? "Return as damaged" : `Return as ${returnCondition === "GOOD" ? "good" : returnCondition === "DAMAGED" ? "damaged" : "missing"}`
      : "Save check";

  const formContent = (
    <>
      {isLoading ? (
        <div className={embedded ? "p-4 space-y-2" : "mt-4 space-y-2"} aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-[var(--r)] border-2 border-line p-3 space-y-2">
              <Skeleton className="h-4 w-2/3 rounded-[var(--r)]" />
              <Skeleton className="h-11 w-full rounded-[var(--r)]" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          className={`flex items-center justify-center py-16 text-center text-ui-text text-muted ${embedded ? "px-4" : ""}`}
        >
          No check items are configured for this {kitId ? "kit" : "model"}.
        </div>
      ) : (
        <div className={embedded ? "p-4 space-y-1" : "mt-4 space-y-1"}>
          {/* Pass All button */}
          {items.some((mci) => mci.checkItem.type === "PASS_FAIL") && (
            <div className="flex justify-end pb-2">
              <Button
                variant="line"
                size="sm"
                onClick={handlePassAll}
                className="text-ok hover:bg-ok-soft hover:text-ok hover:border-ok/40"
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Pass all
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
              isFocused={!embedded && index === focusedRowIndex && mci.checkItem.type === "PASS_FAIL"}
              onFocus={() => setFocusedRowIndex(index)}
              onUpdate={(updates) => updateCheck(mci.checkItem.id, updates)}
              getMeasurementAutoResult={getMeasurementAutoResult}
              onFailPhotoUploadingChange={updateFailPhotoUploading}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className={`${embedded ? "px-4 pb-4" : "mt-6"} border-t border-line pt-4 space-y-3`}>
        {failCount > 0 && (
          <div className="flex items-center gap-2 rounded-[var(--r)] border-l-[3px] border-l-warn bg-warn-soft px-3 py-2 text-ui-text text-warn">
            <XCircle className="h-4 w-4 shrink-0" />
            {failCount} item{failCount !== 1 ? "s" : ""} failed — will be returned as damaged
          </div>
        )}

        {/* Return condition selector */}
        {context === "RETURN" && failCount === 0 && (
          <div className="space-y-2">
            <Label className="text-ui-text font-medium">Return condition</Label>
            <div className="flex gap-2">
              {(["GOOD", "DAMAGED", "MISSING"] as const).map((cond) => {
                const active = returnCondition === cond;
                // Active state carries the condition's semantic tint (§3) —
                // good=ok, damaged=warn, missing=problem (t-out). Inactive is a
                // plain line button.
                const activeClass =
                  cond === "GOOD"
                    ? "bg-ok-soft text-ok border-ok/40"
                    : cond === "DAMAGED"
                      ? "bg-warn-soft text-warn border-warn/40"
                      : "bg-out-soft text-t-out border-t-out/40";
                return (
                  <Button
                    key={cond}
                    type="button"
                    variant="line"
                    size="sm"
                    aria-pressed={active}
                    className={cn("flex-1", active && activeClass)}
                    onClick={() => setReturnCondition(cond)}
                  >
                    {cond === "GOOD" ? "Good" : cond === "DAMAGED" ? "Damaged" : "Missing"}
                  </Button>
                );
              })}
            </div>
            {(returnCondition === "DAMAGED" || returnCondition === "MISSING") && (
              <Textarea
                placeholder={`Notes about ${returnCondition === "DAMAGED" ? "damage" : "missing item"}...`}
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                rows={2}
                className="text-ui-text"
              />
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="line"
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
            loading={isSubmitting}
          >
            {submitLabel}
          </Button>
        </div>

        {/* Keyboard-shortcut hint bar — desktop only, non-embedded */}
        {!embedded && items.some((mci) => mci.checkItem.type === "PASS_FAIL") && (
          <div className="hidden sm:flex items-center justify-center gap-3 pt-1 text-micro text-muted tabular-nums">
            <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">P</kbd> pass</span>
            <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">F</kbd> fail</span>
            <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">A</kbd> pass all</span>
            <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">↑↓</kbd> move</span>
            <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">↵</kbd> submit</span>
          </div>
        )}
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
            {queueTotal && queueTotal > 1 ? (
              <span className="shrink-0 rounded-[var(--r)] bg-red-soft px-1.5 py-0.5 text-caption font-semibold text-red tabular-nums">
                {queuePosition}/{queueTotal}
              </span>
            ) : null}
            <span className="t-mono text-red">{assetTag || "—"}</span>
            <span className="text-muted">—</span>
            <span className="truncate text-ink">{assetName}</span>
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Badge status="neutral">
              {contextLabel}
            </Badge>
            <span className="text-caption text-muted">
              {items.length} check{items.length !== 1 ? "s" : ""}
            </span>
            {onPassAllRemaining && queueTotal && queuePosition && queueTotal > 1 && (
              <Button
                variant="line"
                size="sm"
                onClick={onPassAllRemaining}
                disabled={isSubmitting}
                className="ml-auto h-9 text-ok hover:bg-ok-soft hover:text-ok hover:border-ok/40"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Pass all {queueTotal - queuePosition + 1} items
              </Button>
            )}
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
  isFocused = false,
  onFocus,
  onUpdate,
  getMeasurementAutoResult,
  onFailPhotoUploadingChange,
}: {
  item: CheckItemData;
  state: CheckState | undefined;
  index: number;
  isFocused?: boolean;
  onFocus?: () => void;
  onUpdate: (updates: Partial<CheckState>) => void;
  getMeasurementAutoResult: (
    value: string,
    min: number | null,
    max: number | null
  ) => "PASS" | "FAIL" | null;
  /** FAIL-only photo upload state, bubbled to the form so submit disables mid-upload.
   *  Stable (keyed by checkItemId) — see ItemCheckForm's updateFailPhotoUploading. */
  onFailPhotoUploadingChange?: (checkItemId: string, uploading: boolean) => void;
}) {
  const ci = item.checkItem;
  const result = state?.result;
  const isFail = result === "FAIL";
  const [showNotes, setShowNotes] = useState(false);
  const notesVisible = showNotes || isFail;
  // Bind the checkItemId once per row so the reference PhotoGridInput depends on
  // stays stable across re-renders (same reasoning as updateFailPhotoUploading).
  const handleFailPhotoUploadingChange = useCallback(
    (uploading: boolean) => onFailPhotoUploadingChange?.(ci.id, uploading),
    [onFailPhotoUploadingChange, ci.id],
  );

  return (
    <div
      onClick={onFocus}
      className={`rounded-[var(--r)] border-2 p-3 transition-colors ${
        isFocused ? "ring-2 ring-red ring-offset-2 ring-offset-paper" : ""
      } ${
        result === "PASS"
          ? "border-ok/40 bg-ok-soft/50"
          : result === "FAIL"
            ? "border-t-out/40 bg-out-soft/60"
            : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ui-text font-medium text-ink">{ci.label}</p>
          {ci.description && (
            <p className="mt-0.5 text-caption text-muted">{ci.description}</p>
          )}
        </div>
        <span className="text-micro text-muted shrink-0 tabular-nums">
          {index + 1}
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

      {/* FAIL — inline "what happened?" reason + photo, required before submit
          (GitHub #898: a genuine FAIL opens a maintenance record, so it needs
          enough detail to act on). */}
      {isFail && (
        <div className="mt-2 space-y-2 rounded-[var(--r)] border-l-[3px] border-l-t-out bg-out-soft/40 p-2.5">
          <p className="text-caption font-medium text-t-out">What happened? (required)</p>
          <Textarea
            value={state?.notes || ""}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            placeholder="Describe the failure..."
            rows={2}
            className="text-ui-text"
          />
          <PhotoGridInput
            value={state?.photos || []}
            onChange={(photos) => onUpdate({ photos })}
            onUploadingChange={handleFailPhotoUploadingChange}
            compact
            maxPhotos={6}
          />
          {(state?.photos.length ?? 0) === 0 && (
            <p className="text-micro text-t-out">At least one photo is required.</p>
          )}
        </div>
      )}

      {/* Notes toggle for non-NOTES, non-FAIL types */}
      {ci.type !== "NOTES" && !isFail && (
        <div className="mt-2">
          {notesVisible ? (
            <Textarea
              value={state?.notes || ""}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="Add notes..."
              rows={2}
              className="text-ui-text"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className={`inline-flex min-h-11 items-center rounded-[var(--r)] px-3 text-caption text-muted transition-colors hover:text-ink ${focusRing}`}
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
        aria-pressed={result === "FAIL"}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-[var(--r)] py-2 min-h-11 text-ui-text font-medium transition-colors ${focusRing} ${
          result === "FAIL"
            ? "bg-out-soft text-t-out ring-1 ring-t-out/50"
            : "bg-elev text-muted hover:text-t-out hover:bg-out-soft"
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
          result === "PASS"
            ? "bg-ok text-dark"
            : "bg-elev text-muted hover:text-ok hover:bg-ok-soft"
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
      className="text-ui-text"
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
          className="flex-1 text-ui-text"
        />
        {unit && <span className="text-ui-text text-muted shrink-0">{unit}</span>}
        {result && (
          <Badge status={result === "PASS" ? "ok" : "overbooked"}>
            {result === "PASS" ? "Pass" : "Fail"}
          </Badge>
        )}
      </div>
      {rangeText && (
        <p className="text-micro text-muted">{rangeText}</p>
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
        if (!v) return;
        const opt = options.find((o) => o.label === v);
        onChange(v, opt?.isFail ?? false);
      }}
    >
      <SelectTrigger className="text-ui-text">
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
                <Badge status="overbooked">
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
