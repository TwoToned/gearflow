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
import { Loader2 } from "lucide-react";
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

export type PriceEditTarget =
  | {
      kind: "project";
      groupId: string;
      title: string;
      price: number | null;
    }
  | {
      kind: "subHire";
      groupId: string;
      title: string;
      quantity: number;
      cost: number | null;
      charge: number | null;
    };

interface PriceEditDialogProps {
  target: PriceEditTarget | null;
  onClose: () => void;
  onInvalidate: () => void;
}

export function PriceEditDialog({ target, onClose, onInvalidate }: PriceEditDialogProps) {
  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        {target && (
          <PriceEditDialogBody
            key={`${target.kind}-${target.groupId}`}
            target={target}
            onClose={onClose}
            onInvalidate={onInvalidate}
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
}: {
  target: PriceEditTarget;
  onClose: () => void;
  onInvalidate: () => void;
}) {

  // Project-mode state
  const [priceInput, setPriceInput] = useState<string>(
    target.kind === "project" && target.price != null ? String(target.price) : "",
  );

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
    mutationFn: ({ groupId, price }: { groupId: string; price: number }) =>
      groupWrites.updatePrice(groupId, price),
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
      projectMut.mutate({ groupId: target.groupId, price: parseFloat(priceInput) || 0 });
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
          <div className="space-y-1.5">
            <Label htmlFor="price-edit-input">Group price ($)</Label>
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
          </div>
        ) : (
          <>
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
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
