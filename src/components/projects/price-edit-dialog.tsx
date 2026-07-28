"use client";

/**
 * PriceEditDialog — unified price-edit surface for ProjectGroup and
 * SubHireGroup rows (Phase 6c). Implements Section 4E from the cross-type
 * unification plan: one dialog, same chrome, conditional sections per
 * group kind.
 *
 * Project group → single "Price" input, calls updateGroupPrice.
 * Sub-hire group → charge + cost inputs (charge first per 8H semantic
 *                  prominence), calls useSubHireWrites().updateGroup with
 *                  the group's existing title preserved.
 *
 * The dialog is wrapper + body so the body can be keyed by groupId —
 * picking a different group remounts the body and resets every input
 * without a setState-in-effect.
 */

import { useState } from "react";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { useProjectGroupWrites } from "@/hooks/use-project-groups-writes";
import { useSubHireWrites } from "@/hooks/use-sub-hire-writes";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockedField } from "@/components/ui/locked-field";
import {
  DiscountField,
  discountEntryValue,
  resolveDiscountAmount,
  toDiscountMode,
  type DiscountMode,
} from "./line-item-form-fields";

export type PriceEditTarget =
  | {
      kind: "project";
      groupId: string;
      title: string;
      quantity: number;
      price: number | null;
      discount: number | null;
      /** #1012 — how `discount` was entered ("$" | "%"). Absent = "$". */
      discountMode?: string | null;
    }
  | {
      kind: "subHire";
      groupId: string;
      title: string;
      quantity: number;
      cost: number | null;
      charge: number | null;
    };

/** #1012 — the stored discount re-expressed as the operator entered it, for
 *  seeding the amount input + `$`/`%` toggle. Sub-hire groups have no discount
 *  field at all (they price by cost/charge), so they seed blank. */
function initialDiscountEntry(target: PriceEditTarget): { value: string; mode: DiscountMode } {
  if (target.kind !== "project") return { value: "", mode: "$" };
  const mode = toDiscountMode(target.discountMode);
  const gross = Number(target.price ?? 0) * (target.quantity || 1);
  return { value: discountEntryValue(target.discount, mode, gross), mode };
}

interface PriceEditDialogProps {
  target: PriceEditTarget | null;
  onClose: () => void;
  onInvalidate: () => void;
  /** #990 — true once the project's tier is locked and no unlock session is
   *  open (the same `defaultToZero` condition the server force-zeros new
   *  money fields under). Money inputs render read-only via `<LockedField>`. */
  locked?: boolean;
  lockReason?: string;
  onUnlockExit?: () => void;
}

export function PriceEditDialog({ target, onClose, onInvalidate, locked, lockReason, onUnlockExit }: PriceEditDialogProps) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        {target && (
          <PriceEditDialogBody
            key={`${target.kind}-${target.groupId}`}
            target={target}
            onClose={onClose}
            onInvalidate={onInvalidate}
            locked={!!locked}
            lockReason={lockReason ?? "Pricing is locked."}
            onUnlockExit={onUnlockExit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PriceEditDialogBody({
  target,
  onClose,
  onInvalidate,
  locked,
  lockReason,
  onUnlockExit,
}: {
  target: PriceEditTarget;
  onClose: () => void;
  onInvalidate: () => void;
  locked: boolean;
  lockReason: string;
  onUnlockExit?: () => void;
}) {

  // Project-mode state
  const [priceInput, setPriceInput] = useState<string>(
    target.kind === "project" && target.price != null ? String(target.price) : "",
  );
  // #1012 — seed both the value and the toggle from the stored entry shape, so a
  // group priced at 10% reopens as "10 %" instead of the resolved dollar amount
  // with the toggle silently reset to "$".
  const initialDiscount = initialDiscountEntry(target);
  const [discountInput, setDiscountInput] = useState<string>(initialDiscount.value);
  const [discountMode, setDiscountMode] = useState<DiscountMode>(initialDiscount.mode);

  // Sub-hire-mode state
  const [chargeInput, setChargeInput] = useState<string>(
    target.kind === "subHire" && target.charge != null ? String(target.charge) : "",
  );
  const [costInput, setCostInput] = useState<string>(
    target.kind === "subHire" && target.cost != null ? String(target.cost) : "",
  );

  const groupWrites = useProjectGroupWrites();
  const subHireWrites = useSubHireWrites();

  const projectMut = useServerMutation({
    mutationFn: ({ groupId, price, discount, discountMode: mode }: {
      groupId: string; price: number; discount?: number; discountMode?: DiscountMode;
    }) => groupWrites.updatePrice(groupId, price, discount, mode),
    onSuccess: () => {
      onInvalidate();
      toast.success("Group price updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const subHireMut = useServerMutation({
    mutationFn: () => {
      if (target.kind !== "subHire") throw new Error("Invalid target");
      // updateGroup re-sends title + quantity untouched alongside the new cost / charge.
      return subHireWrites.updateGroup(target.groupId, {
        title: target.title,
        quantity: target.quantity,
        charge: chargeInput !== "" ? parseFloat(chargeInput) : null,
        cost: costInput !== "" ? parseFloat(costInput) : null,
      });
    },
    onSuccess: () => {
      onInvalidate();
      toast.success("Sub-hire group pricing updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPending = projectMut.isPending || subHireMut.isPending;

  function handleSubmit() {
    if (target.kind === "project") {
      const price = parseFloat(priceInput) || 0;
      // #1012: the shared conversion (resolveDiscountAmount) resolves a `%` entry
      // to the flat dollar amount the mutation stores — and the MODE now travels
      // with it so documents can print the discount the way it was entered.
      // `?? 0` keeps the pre-#1012 behaviour of a non-blank-but-invalid entry
      // ("abc", "-5") clearing the discount rather than leaving it untouched.
      const discount = discountInput
        ? resolveDiscountAmount(discountMode, discountInput, price * (target.quantity || 1)) ?? 0
        : undefined;
      projectMut.mutate({ groupId: target.groupId, price, discount, discountMode });
    } else {
      subHireMut.mutate();
    }
  }

  const margin =
    target.kind === "subHire" && chargeInput !== "" && costInput !== ""
      ? parseFloat(chargeInput) - parseFloat(costInput)
      : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {target.kind === "project"
            ? `Price for "${target.title}"`
            : `Pricing for "${target.title}"`}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {target.kind === "project" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="price-edit-input">Group price ($)</Label>
              <LockedField locked={locked} reason={lockReason} exitLabel={onUnlockExit ? "Unlock financials" : undefined} onExit={onUnlockExit}>
                <Input
                  id="price-edit-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                  }}
                  autoFocus
                />
              </LockedField>
            </div>
            <LockedField locked={locked} reason={lockReason} exitLabel={onUnlockExit ? "Unlock financials" : undefined} onExit={onUnlockExit}>
              <DiscountField
                id="price-edit-discount"
                value={discountInput}
                onValueChange={setDiscountInput}
                mode={discountMode}
                onModeChange={setDiscountMode}
              />
            </LockedField>
          </>
        ) : (
          <>
            {/* Sub-hire charge/cost are NOT wrapped in `<LockedField>` — unlike
                a project group's price, `subHiresWrites.ts#updateGroup` doesn't
                call `assertLifecycleGuard` at all, so the server never actually
                gates this edit. Rendering it locked would be a UI lie
                (finance-workflow-ux.md §7.3 "server parity, non-negotiable"). */}
            <div className="space-y-1.5">
              <Label htmlFor="charge-input">Charge to client ($)</Label>
              <Input
                id="charge-input"
                type="number"
                step="0.01"
                min="0"
                value={chargeInput}
                onChange={(e) => setChargeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-input">Cost from supplier ($)</Label>
              <Input
                id="cost-input"
                type="number"
                step="0.01"
                min="0"
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>
            {margin != null && (
              <p className="text-xs text-fg-3">
                Margin per unit: ${margin.toFixed(2)}
              </p>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="line" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} loading={isPending}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
