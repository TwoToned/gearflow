"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { showError } from "@/lib/show-error";
import { prepItemsBatch, prepKitsBatch } from "@/server/check-records";
import type { LineItem } from "@/components/warehouse/warehouse-types";
import type { useDurableScanIntake } from "@/hooks/use-durable-scan-intake";
import type { CheckFlow, KitConfirmState, ReturnConditionValue, StageMutations } from "./job-types";

type Durable = ReturnType<typeof useDurableScanIntake>;

/**
 * "Prep / Return without full verification?" for a kit: only the verified items, or everything. A
 * durable (scan) operation reviews instead of writing, so the saved scan's payload stays the one source.
 */
export function KitConfirmDialog({
  kit, onClose, durable, projectId, lineItems, mutations, checkFlow, check, invalidate,
}: {
  kit: KitConfirmState;
  onClose: () => void;
  durable: Durable;
  projectId: string;
  lineItems: LineItem[];
  mutations: StageMutations;
  checkFlow: CheckFlow;
  check: { condition: ReturnConditionValue; notes: string };
  invalidate: () => void;
}) {
  const verb = kit.action === "deploy" ? "Prep" : "Return";
  const verifiedOnly = () => {
    if (kit.durableOperationId) {
      if (durable.review(kit.durableOperationId, { kitId: kit.kitId, lineItemId: kit.parentLineItemId, kitDecision: "verified", verifiedLineItemIds: kit.verifiedIds })) onClose();
      return;
    }
    if (kit.action === "deploy") {
      prepItemsBatch(projectId, kit.verifiedIds.map((id) => ({ lineItemId: id })))
        .then(() => { toast.success(`Prepped ${kit.verifiedCount} verified items`); invalidate(); })
        .catch((e) => showError(e));
    } else {
      // Return only the verified children; the kit parent stays deployed until all are back.
      mutations.checkInMutation
        .mutateAsync({ items: kit.verifiedIds.map((id) => ({ lineItemId: id, returnCondition: check.condition, notes: check.notes || undefined })) })
        .then(() => toast.success(`Returned ${kit.verifiedCount} verified items`))
        .catch(() => {});
    }
    onClose();
  };
  const everything = () => {
    if (kit.durableOperationId) {
      if (durable.review(kit.durableOperationId, { kitId: kit.kitId, lineItemId: kit.parentLineItemId, kitDecision: "all" })) onClose();
      return;
    }
    const kitLi = lineItems.find((l) => l.kitId === kit.kitId && !l.isKitChild);
    const started = kitLi ? checkFlow.startKitCheckFlow(kit.kitId, kitLi, kit.action === "deploy" ? "PREP" : "RETURN", check.condition) : false;
    if (!started && kit.action === "deploy") {
      prepKitsBatch(projectId, [kit.parentLineItemId])
        .then((res) => {
          if (res.errors.length > 0) toast.error(`Kit skipped: ${kit.kitName}`); else toast.success(`Kit prepped: ${kit.kitName}`);
          invalidate();
        })
        .catch((e) => showError(e, { fallbackTitle: "Failed to prep kit" }));
    } else if (!started) mutations.kitCheckInMutation.mutate({ kitId: kit.kitId, returnCondition: check.condition });
    onClose();
  };
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kit.action === "deploy" ? "Prep without full verification?" : "Return without full verification?"}</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-muted">
          <span className="font-medium text-ink">{kit.kitName}</span> has{" "}
          <span className="font-medium text-ink tabular-nums">{kit.verifiedCount}/{kit.totalCount}</span>{" "}
          items verified. You can {verb.toLowerCase()} only the verified items, or {verb.toLowerCase()} everything.
        </p>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="line" size="sm" onClick={() => onClose()}>Cancel</Button>
          {kit.verifiedCount > 0 && <Button variant="line" size="sm" onClick={verifiedOnly}>{verb} Verified ({kit.verifiedCount})</Button>}
          <Button size="sm" onClick={everything}>{verb} All ({kit.totalCount})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
