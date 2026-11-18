"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { useDurableScanIntake } from "@/hooks/use-durable-scan-intake";
import type { AccessoryVerifyState, CheckOutItem } from "./job-types";

type Durable = ReturnType<typeof useDurableScanIntake>;

/** "Deploy Verified Only" vs "Deploy All" for an accessory parent whose packed accessories are only partly verified. */
export function AccessoryVerifyDialog({
  confirm, onClose, durable, runCheckOut,
}: {
  confirm: AccessoryVerifyState;
  onClose: () => void;
  durable: Durable;
  runCheckOut: (items: CheckOutItem[]) => void;
}) {
  const base = { lineItemId: confirm.parentLineItemId, assetId: confirm.parentAssetId };
  const decide = (verifiedOnly: boolean) => {
    if (confirm.durableOperationId) {
      durable.review(confirm.durableOperationId, verifiedOnly
        ? { ...base, accessoryDecision: "verified", includeAccessoryIds: confirm.verifiedAccessoryIds }
        : { ...base, accessoryDecision: "all" });
    } else runCheckOut([verifiedOnly ? { ...base, includeAccessoryIds: confirm.verifiedAccessoryIds } : base]);
    onClose();
  };
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Deploy without full verification?</DialogTitle></DialogHeader>
        <p className="text-ui-text text-muted">
          <span className="font-medium text-ink">{confirm.parentName}</span> has{" "}
          <span className="font-medium text-ink tabular-nums">{confirm.verifiedCount}/{confirm.totalCount}</span>{" "}
          accessories verified. You can deploy the parent with only the verified accessories, or deploy with everything.
        </p>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="line" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="line" size="sm" onClick={() => decide(true)}>Deploy Verified Only ({confirm.verifiedCount})</Button>
          <Button size="sm" onClick={() => decide(false)}>Deploy All ({confirm.totalCount})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
