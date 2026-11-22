"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { CheckRecordFormValues } from "@/lib/validations/check-item";
import {
  checkFailCount,
  checksComplete,
  checksPayload,
  hasPassFail,
  initialCheckStates,
  passAllStates,
  type CheckItemData,
  type CheckState,
  type CheckStates,
} from "@/lib/check-item-state";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CheckItemFields } from "@/components/warehouse/check-item-fields";

type ReturnCondition = "GOOD" | "DAMAGED" | "MISSING";

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
  onSubmit: (checks: CheckRecordFormValues[], returnInfo?: { condition: ReturnCondition; notes?: string }) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  /** Queue position (1-based) when processing multiple items */
  queuePosition?: number;
  /** Total items in queue */
  queueTotal?: number;
  /** Callback to pass all remaining items in the queue */
  onPassAllRemaining?: () => void;
}

/** A model's (or kit's) check items, read browser-direct once the sheet is open. */
function useCheckItems(open: boolean, modelId: string | undefined, kitId: string | undefined) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data = [], isLoading } = useServerQuery<unknown[]>({
    // isAuthenticated is in the key so the query re-runs once Convex auth is ready
    // (useServerQuery won't otherwise retry a read that ran before auth settled).
    queryKey: kitId ? ["kit-check-items", orgId, kitId, isAuthenticated] : ["model-check-items", orgId, modelId, isAuthenticated],
    queryFn: () =>
      (kitId
        ? convex.query(api.kitCheckItems.assignmentsForKit, { orgId: orgId!, kitId })
        : convex.query(api.modelCheckItems.assignmentsForModel, { orgId: orgId!, modelId: modelId! })) as Promise<unknown[]>,
    enabled: open && !!orgId && isAuthenticated && !!(modelId || kitId),
  });
  return { items: data as unknown as CheckItemData[], isLoading };
}

function submitLabelFor(context: ItemCheckFormProps["context"], failCount: number, returnCondition: ReturnCondition): string {
  if (context === "PREP") return failCount > 0 ? "Flag item" : "Pack item";
  if (context !== "RETURN") return "Save check";
  if (failCount > 0) return "Return as damaged";
  return `Return as ${returnCondition === "GOOD" ? "good" : returnCondition === "DAMAGED" ? "damaged" : "missing"}`;
}

const CONTEXT_LABEL: Record<ItemCheckFormProps["context"], string> = {
  PREP: "Prep check",
  RETURN: "Return check",
  AD_HOC: "Ad-hoc check",
};

/**
 * The warehouse check sheet (prep / return / kit checks): the item list
 * (`CheckItemFields`, shared with the Scan page's inline Check form), Pass all, the
 * RETURN condition words, and the desktop hotkeys. The Scan page renders the same
 * item list inline and owns its own save (Phase 16).
 */
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
  queuePosition,
  queueTotal,
  onPassAllRemaining,
}: ItemCheckFormProps) {
  const { items, isLoading } = useCheckItems(open, modelId, kitId);

  const [checkStates, setCheckStates] = useState<CheckStates>({});
  const [passAllUndo, setPassAllUndo] = useState<ReturnType<typeof setTimeout> | null>(null);
  const passAllUndoRef = useRef<CheckStates | null>(null);

  // Return condition state (only used when context === "RETURN")
  const [returnCondition, setReturnCondition] = useState<ReturnCondition>("GOOD");
  const [returnNotes, setReturnNotes] = useState("");

  // Keyboard-shortcut cursor: which row is "active" for P/F keystrokes.
  // Points at an index within the full items[] array — arrow keys skip non-PASS_FAIL rows.
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);

  // Inline FAIL reason/photo capture (#898): uploading state is tracked per
  // checkItemId so submit stays disabled while any FAIL row's photo is uploading.
  const [failPhotosUploading, setFailPhotosUploading] = useState<Record<string, boolean>>({});
  const anyFailPhotoUploading = Object.values(failPhotosUploading).some(Boolean);
  // Stable across renders so PhotoGridInput's effect only re-fires on a real change.
  const updateFailPhotoUploading = useCallback((checkItemId: string, uploading: boolean) => {
    setFailPhotosUploading((prev) => ({ ...prev, [checkItemId]: uploading }));
  }, []);

  // Refs used by the keyboard handler so it reads the latest props/state without re-binding.
  const handleSubmitRef = useRef<() => void>(() => {});
  const handlePassAllRef = useRef<() => void>(() => {});
  const stateRef = useRef<KeyState>({ items: [], focusedRowIndex: 0, isSubmitting: false, isLoading: false });

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
      setCheckStates(initialCheckStates(items));
      setPassAllUndo(null);
      passAllUndoRef.current = null;
      setReturnCondition("GOOD");
      setReturnNotes("");
      // Land the keyboard cursor on the first PASS_FAIL row if there is one, else row 0
      const firstPassFail = items.findIndex((mci) => mci.checkItem.type === "PASS_FAIL");
      setFocusedRowIndex(firstPassFail >= 0 ? firstPassFail : 0);
    }
  }, [open, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCheck = useCallback((checkItemId: string, updates: Partial<CheckState>) => {
    setCheckStates((prev) => ({ ...prev, [checkItemId]: { ...prev[checkItemId], ...updates } }));
  }, []);

  // Pass All — sets all unanswered PASS_FAIL items to PASS with 3s undo
  function handlePassAll() {
    passAllUndoRef.current = { ...checkStates };
    setCheckStates(passAllStates(items, checkStates));

    const timer = setTimeout(() => {
      setPassAllUndo(null);
      passAllUndoRef.current = null;
    }, 3000);
    setPassAllUndo(timer);

    toast.success("All pass/fail items marked as Pass", {
      action: {
        label: "Undo",
        onClick: () => {
          if (passAllUndoRef.current) setCheckStates(passAllUndoRef.current);
          clearTimeout(timer);
          setPassAllUndo(null);
          passAllUndoRef.current = null;
        },
      },
      duration: 3000,
    });
  }

  const allComplete = checksComplete(items, checkStates, anyFailPhotoUploading);
  const failCount = checkFailCount(checkStates);

  function handleSubmit() {
    if (!allComplete || isSubmitting) return;
    const checks = checksPayload(items, checkStates);
    if (context === "RETURN") {
      // Auto-override condition to DAMAGED if any checks failed
      onSubmit(checks, { condition: failCount > 0 ? "DAMAGED" : returnCondition, notes: returnNotes || undefined });
    } else {
      onSubmit(checks);
    }
  }

  // Latest-value refs: sync after every commit (assigning during render trips
  // react-hooks/refs); the listener only reads `.current` at event time.
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
    handlePassAllRef.current = handlePassAll;
    stateRef.current = { items, focusedRowIndex, isSubmitting, isLoading };
  });

  useCheckHotkeys({ open, stateRef, setCheckStates, setFocusedRowIndex, handlePassAllRef, handleSubmitRef });

  const showPassFail = hasPassFail(items);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {queueTotal && queueTotal > 1 ? (
              <span className="shrink-0 rounded-[var(--r)] bg-red-soft px-1.5 py-0.5 text-caption font-semibold text-red-text tabular-nums">
                {queuePosition}/{queueTotal}
              </span>
            ) : null}
            <span className="t-mono text-red-text">{assetTag || "—"}</span>
            <span className="text-muted">—</span>
            <span className="truncate text-ink">{assetName}</span>
          </SheetTitle>
          <div className="flex items-center gap-2">
            <Badge status="neutral">{CONTEXT_LABEL[context]}</Badge>
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
        <ItemList
          isLoading={isLoading}
          items={items}
          isKit={!!kitId}
          showPassAll={showPassFail}
          onPassAll={handlePassAll}
        >
          <CheckItemFields
            items={items}
            states={checkStates}
            onUpdate={updateCheck}
            focusedRowIndex={focusedRowIndex}
            onFocusRow={setFocusedRowIndex}
            onFailPhotoUploadingChange={updateFailPhotoUploading}
          />
        </ItemList>

        <div className="mt-6 border-t border-line pt-4 space-y-3">
          {failCount > 0 && (
            <div className="flex items-center gap-2 rounded-[var(--r)] border-l-[3px] border-l-warn bg-warn-soft px-3 py-2 text-ui-text text-warn">
              <XCircle className="h-4 w-4 shrink-0" />
              {failCount} item{failCount !== 1 ? "s" : ""} failed — will be returned as damaged
            </div>
          )}

          {context === "RETURN" && failCount === 0 && (
            <ReturnConditionPicker
              value={returnCondition}
              onChange={setReturnCondition}
              notes={returnNotes}
              onNotesChange={setReturnNotes}
            />
          )}

          <div className="flex gap-2">
            <Button variant="line" className="flex-1" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={!allComplete || isSubmitting} loading={isSubmitting}>
              {submitLabelFor(context, failCount, returnCondition)}
            </Button>
          </div>

          {/* Keyboard-shortcut hint bar — desktop only */}
          {showPassFail && (
            <div className="hidden sm:flex items-center justify-center gap-3 pt-1 text-micro text-muted tabular-nums">
              <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">P</kbd> pass</span>
              <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">F</kbd> fail</span>
              <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">A</kbd> pass all</span>
              <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">↑↓</kbd> move</span>
              <span><kbd className="rounded-[6px] bg-elev px-1 py-0.5 font-mono">↵</kbd> submit</span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ItemList({
  isLoading,
  items,
  isKit,
  showPassAll,
  onPassAll,
  children,
}: {
  isLoading: boolean;
  items: CheckItemData[];
  isKit: boolean;
  showPassAll: boolean;
  onPassAll: () => void;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="mt-4 space-y-2" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-[var(--r)] border-2 border-line p-3 space-y-2">
            <Skeleton className="h-4 w-2/3 rounded-[var(--r)]" />
            <Skeleton className="h-11 w-full rounded-[var(--r)]" />
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-center text-ui-text text-muted">
        No check items are configured for this {isKit ? "kit" : "model"}.
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-1">
      {showPassAll && (
        <div className="flex justify-end pb-2">
          <Button variant="line" size="sm" onClick={onPassAll} className="text-ok hover:bg-ok-soft hover:text-ok hover:border-ok/40">
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Pass all
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}

const RETURN_CONDITION_ACTIVE: Record<ReturnCondition, string> = {
  // Active state carries the condition's semantic tint (§3).
  GOOD: "bg-ok-soft text-ok border-ok/40",
  DAMAGED: "bg-warn-soft text-warn border-warn/40",
  MISSING: "bg-out-soft text-t-out border-t-out/40",
};
const RETURN_CONDITION_LABEL: Record<ReturnCondition, string> = { GOOD: "Good", DAMAGED: "Damaged", MISSING: "Missing" };

function ReturnConditionPicker({
  value,
  onChange,
  notes,
  onNotesChange,
}: {
  value: ReturnCondition;
  onChange: (c: ReturnCondition) => void;
  notes: string;
  onNotesChange: (n: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-ui-text font-medium">Return condition</Label>
      <div className="flex gap-2">
        {(["GOOD", "DAMAGED", "MISSING"] as const).map((cond) => (
          <Button
            key={cond}
            type="button"
            variant="line"
            size="sm"
            aria-pressed={value === cond}
            className={cn("flex-1", value === cond && RETURN_CONDITION_ACTIVE[cond])}
            onClick={() => onChange(cond)}
          >
            {RETURN_CONDITION_LABEL[cond]}
          </Button>
        ))}
      </div>
      {(value === "DAMAGED" || value === "MISSING") && (
        <Textarea
          placeholder={`Notes about ${value === "DAMAGED" ? "damage" : "missing item"}...`}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          className="text-ui-text"
        />
      )}
    </div>
  );
}

// ─── Keyboard shortcuts ─────────────────────────────────────────────────
// P / F         — pass or fail the focused PASS_FAIL row
// A             — pass all remaining PASS_FAIL rows (same as the button)
// ArrowUp/Down  — move the focused row cursor, skipping non-PASS_FAIL rows
// Enter         — submit if all complete
// Guards: ignore when any text input/textarea/select/contenteditable has focus,
//         and when the form is submitting or loading.

interface KeyState {
  items: CheckItemData[];
  focusedRowIndex: number;
  isSubmitting: boolean;
  isLoading: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function passFailIndices(items: CheckItemData[]): number[] {
  return items.map((mci, i) => (mci.checkItem.type === "PASS_FAIL" ? i : -1)).filter((i) => i >= 0);
}

function nextCursor(indices: number[], focused: number, down: boolean): number {
  const pos = indices.indexOf(focused);
  if (down) return indices[pos < 0 ? 0 : Math.min(pos + 1, indices.length - 1)];
  return indices[pos < 0 ? indices.length - 1 : Math.max(pos - 1, 0)];
}

function useCheckHotkeys({
  open,
  stateRef,
  setCheckStates,
  setFocusedRowIndex,
  handlePassAllRef,
  handleSubmitRef,
}: {
  open: boolean;
  stateRef: React.RefObject<KeyState>;
  setCheckStates: React.Dispatch<React.SetStateAction<CheckStates>>;
  setFocusedRowIndex: (i: number) => void;
  handlePassAllRef: React.RefObject<() => void>;
  handleSubmitRef: React.RefObject<() => void>;
}) {
  useEffect(() => {
    if (!open) return;

    function onPassFailKey(e: KeyboardEvent, s: KeyState, indices: number[]) {
      const focusedItem = s.items[s.focusedRowIndex];
      if (!focusedItem || focusedItem.checkItem.type !== "PASS_FAIL") return;
      const result = e.key.toLowerCase() === "p" ? "PASS" : "FAIL";
      e.preventDefault();
      const id = focusedItem.checkItem.id;
      setCheckStates((prev) => ({ ...prev, [id]: { ...prev[id], result } }));
      // Auto-advance to next PASS_FAIL row
      const pos = indices.indexOf(s.focusedRowIndex);
      if (pos >= 0 && pos + 1 < indices.length) setFocusedRowIndex(indices[pos + 1]);
    }

    function onKey(e: KeyboardEvent) {
      const s = stateRef.current;
      if (s.isSubmitting || s.isLoading) return;
      // Modifier keys → let the browser handle (e.g. Cmd+R); typing → leave it alone
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const indices = passFailIndices(s.items);
      if (key === "p" || key === "f") return onPassFailKey(e, s, indices);
      if (key === "enter") {
        e.preventDefault();
        handleSubmitRef.current();
        return;
      }
      if (indices.length === 0) return;
      if (key === "a") {
        e.preventDefault();
        handlePassAllRef.current();
      } else if (key === "arrowdown" || key === "arrowup") {
        e.preventDefault();
        setFocusedRowIndex(nextCursor(indices, s.focusedRowIndex, key === "arrowdown"));
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, stateRef, setCheckStates, setFocusedRowIndex, handlePassAllRef, handleSubmitRef]);
}
