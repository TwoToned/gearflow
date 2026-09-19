"use client";

/**
 * Shared DEFAULT/OPTIONAL accessory checkbox list + "remove a default needs a
 * reason" confirmation dialog (issue #794 + its follow-up). Extracted from
 * `EquipmentAddForm` so the add-time picker and the existing-line "Edit
 * accessories" dialog (`EditAccessoryPlanDialog`) render and behave identically
 * instead of carrying two copies of this UI (R-3.1/R-3.8) — only how each
 * caller SEEDS `selection`/`excludeReasons` differs (add defaults every
 * DEFAULT row to included; edit seeds from the line's stored `accessoryPlan`).
 *
 * Controlled: the caller owns `selection` (accessory row id → included) and
 * `excludeReasons` (accessory row id → typed reason for a deselected DEFAULT)
 * and re-derives its `AccessoryPlanInput` from them however it needs to.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ModelAccessoryDetail } from "@/server/line-items";

export interface AccessorySelectionFieldsProps {
  accessories: ModelAccessoryDetail[];
  /** Scales each accessory's configured per-parent quantity for display
   *  (`a.quantity * quantity`×). The line's own ordered quantity. */
  quantity: number;
  selection: Record<string, boolean>;
  onSelectionChange: (next: Record<string, boolean>) => void;
  excludeReasons: Record<string, string>;
  onExcludeReasonsChange: (next: Record<string, string>) => void;
}

export function AccessorySelectionFields({
  accessories,
  quantity,
  selection,
  onSelectionChange,
  excludeReasons,
  onExcludeReasonsChange,
}: AccessorySelectionFieldsProps) {
  const [pendingExclude, setPendingExclude] = useState<{ id: string; label: string } | null>(null);
  const [excludeReasonDraft, setExcludeReasonDraft] = useState("");

  if (accessories.length === 0) return null;

  const defaultAccessories = accessories.filter((a) => a.inclusion !== "OPTIONAL");
  const optionalAccessories = accessories.filter((a) => a.inclusion === "OPTIONAL");

  return (
    <>
      <div className="space-y-2.5 rounded-[var(--r)] border border-line bg-paper-2/50 p-3">
        <p className="t-overline text-muted">Accessories</p>

        {defaultAccessories.length > 0 && (
          <div className="space-y-1.5">
            <p className="t-micro text-faint">Included</p>
            {defaultAccessories.map((a) => {
              const checked = selection[a.id] ?? true;
              const label = a.modelName ?? a.assetTag;
              return (
                <div key={a.id} className="space-y-1">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        if (c === true) {
                          onSelectionChange({ ...selection, [a.id]: true });
                          const nextReasons = { ...excludeReasons };
                          delete nextReasons[a.id];
                          onExcludeReasonsChange(nextReasons);
                        } else {
                          setExcludeReasonDraft("");
                          setPendingExclude({ id: a.id, label });
                        }
                      }}
                    />
                    <span className="text-ui-text text-ink-2">
                      <span className="t-data tabular-nums">{a.quantity * quantity}×</span>{" "}
                      {label}
                    </span>
                  </label>
                  {!checked && excludeReasons[a.id] && (
                    <p className="pl-6 t-micro text-muted">Removed: {excludeReasons[a.id]}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {optionalAccessories.length > 0 && (
          <div className="space-y-1.5">
            <p className="t-micro text-faint">Optional</p>
            {optionalAccessories.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={selection[a.id] ?? false}
                  onCheckedChange={(c) => onSelectionChange({ ...selection, [a.id]: c === true })}
                />
                <span className="text-ui-text text-ink-2">
                  <span className="t-data tabular-nums">{a.quantity * quantity}×</span>{" "}
                  {a.modelName ?? a.assetTag}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Removing a DEFAULT accessory is a deliberate override — require a
          reason before it actually excludes (issue #794 follow-up). Optional
          accessories stay a plain, frictionless checkbox. */}
      <Dialog open={!!pendingExclude} onOpenChange={(o) => !o && setPendingExclude(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove default accessory?</DialogTitle>
          </DialogHeader>
          <p className="text-caption text-muted">
            <span className="font-medium text-ink">{pendingExclude?.label}</span> ships with every asset
            of this model by default. Removing it from just this line needs a reason.
          </p>
          <div className="space-y-2 py-2">
            <Label htmlFor="exclude-reason">Reason</Label>
            <Textarea
              id="exclude-reason"
              value={excludeReasonDraft}
              onChange={(e) => setExcludeReasonDraft(e.target.value)}
              placeholder="e.g. customer is supplying their own"
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button variant="line" onClick={() => setPendingExclude(null)}>
              Cancel
            </Button>
            <Button
              disabled={!excludeReasonDraft.trim()}
              onClick={() => {
                if (!pendingExclude) return;
                onSelectionChange({ ...selection, [pendingExclude.id]: false });
                onExcludeReasonsChange({ ...excludeReasons, [pendingExclude.id]: excludeReasonDraft.trim() });
                setPendingExclude(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
