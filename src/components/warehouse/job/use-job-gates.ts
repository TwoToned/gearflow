"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accessoryChildrenOf, type LineItem } from "@/components/warehouse/warehouse-types";
import type { AccessoryGateState, AccessoryVerifyState, KitConfirmState } from "./job-types";

/**
 * The page's confirm-dialog state and click-to-verify set, in one place: the kit confirm
 * (single slot + backlog), the missing-accessory gate, the partial-verify confirm, and the
 * verified ids shared by Prep/Deploy/Return. `resetKey` clears the dialogs when the scope changes.
 */
export function useJobGates(lineItems: LineItem[], resetKey: string) {
  const [verifiedKitItems, setVerifiedKitItems] = useState<Set<string>>(new Set());
  const [kitConfirm, setKitConfirm] = useState<KitConfirmState | null>(null);
  // Further unverified kits from the same selection, and kits held back while another check queue
  // runs: the dialog is single-slot, so these wait their turn rather than clobber the selection.
  const kitConfirmBacklogRef = useRef<KitConfirmState[]>([]);
  const closeKitConfirm = () => setKitConfirm(kitConfirmBacklogRef.current.shift() ?? null);
  const [accessoryGate, setAccessoryGate] = useState<AccessoryGateState | null>(null);
  const [accessoryVerifyConfirm, setAccessoryVerifyConfirm] = useState<AccessoryVerifyState | null>(null);

  useEffect(() => {
    setKitConfirm(null);
    setAccessoryGate(null);
    setAccessoryVerifyConfirm(null);
    kitConfirmBacklogRef.current = [];
  }, [resetKey]);

  // Verification done while picking must not pre-tick the Deploy checks, so a successful prep
  // clears the prepped lines' accessory ids; Deploy then starts from a clean slate.
  const clearAccessoryVerification = useCallback((lineItemIds: string[]) => {
    const toClear = new Set<string>();
    for (const id of lineItemIds) {
      const li = lineItems.find((l) => l.id === id);
      if (li) accessoryChildrenOf(li).forEach((c) => toClear.add(c.id));
    }
    if (toClear.size === 0) return;
    setVerifiedKitItems((prev) => {
      if (![...toClear].some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      toClear.forEach((id) => next.delete(id));
      return next;
    });
  }, [lineItems]);

  return {
    verifiedKitItems, setVerifiedKitItems, kitConfirm, setKitConfirm, kitConfirmBacklogRef, closeKitConfirm,
    accessoryGate, setAccessoryGate, accessoryVerifyConfirm, setAccessoryVerifyConfirm, clearAccessoryVerification,
  };
}
export type JobGates = ReturnType<typeof useJobGates>;
