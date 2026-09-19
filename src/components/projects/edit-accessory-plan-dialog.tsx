"use client";

/**
 * "Edit accessories" — reopens the accessory picker for a line ALREADY on the
 * project (issue #794's originally-planned post-add entry point; the mutation
 * `updateAccessoryPlanNative` / `useLineItemWrites().updateAccessoryPlan` has
 * existed since then with no UI trigger until now). Seeds the SAME
 * `AccessorySelectionFields` checkbox list `EquipmentAddForm` uses at add time,
 * but seeded from the line's own stored `accessoryPlan` (fetched fresh via
 * `projectLineItems.getById` — `LineItemData` doesn't carry `accessoryPlan`,
 * only the fields already needed for display) instead of catalog defaults.
 *
 * Eligibility (top-level line, has a model/asset, not deployed) is enforced
 * both here (menu visibility, `canEditAccessoryPlan`) and server-side
 * (`assertLineOwnsAccessoryPlan` — the authority; this is UX only).
 */

import { useMemo, useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { api } from "../../../convex/_generated/api";
import { checkAvailability, lookupAssetByTag, type ModelAccessoryDetail } from "@/server/line-items";
import { useLineItemWrites, type AccessoryPlanInput } from "@/hooks/use-line-item-writes";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AccessorySelectionFields } from "./accessory-selection-fields";
import type { LineItemData } from "./equipment-row-types";
import { toast } from "sonner";

export interface EditAccessoryPlanDialogProps {
  /** The line being edited — needs `id`/`modelId`/`asset.assetTag`/`quantity`/
   *  `description` from the already-loaded row; `accessoryPlan` isn't on this
   *  type, so it's fetched fresh below. */
  item: LineItemData | null;
  onClose: () => void;
}

/** An OPTIONAL row starts excluded unless its `bulkAssetId` was opted in. */
function seedOptionalRow(a: ModelAccessoryDetail, currentPlan: AccessoryPlanInput | undefined): boolean {
  return currentPlan?.added?.some((x) => x.bulkAssetId === a.bulkAssetId) ?? false;
}

/** A DEFAULT row starts included unless its `bulkAssetId` was excluded — in
 *  which case it also carries whatever reason was recorded for the removal. */
function seedDefaultRow(
  a: ModelAccessoryDetail,
  currentPlan: AccessoryPlanInput | undefined,
): { included: boolean; reason?: string } {
  const excluded = currentPlan?.excluded?.includes(a.bulkAssetId) ?? false;
  if (!excluded) return { included: true };
  return { included: false, reason: currentPlan?.excludedReasons?.find((r) => r.bulkAssetId === a.bulkAssetId)?.reason };
}

/** Seed `selection`/`excludeReasons` from the line's stored `accessoryPlan`
 *  against the model/asset's CURRENT catalog rows. */
function seedAccessorySelection(
  accessories: ModelAccessoryDetail[],
  currentPlan: AccessoryPlanInput | undefined,
): { selection: Record<string, boolean>; excludeReasons: Record<string, string> } {
  const selection: Record<string, boolean> = {};
  const excludeReasons: Record<string, string> = {};
  for (const a of accessories) {
    if (a.inclusion === "OPTIONAL") {
      selection[a.id] = seedOptionalRow(a, currentPlan);
      continue;
    }
    const row = seedDefaultRow(a, currentPlan);
    selection[a.id] = row.included;
    if (row.reason) excludeReasons[a.id] = row.reason;
  }
  return { selection, excludeReasons };
}

/** Derive the `AccessoryPlanInput` to save from the current checkbox state —
 *  same shape `EquipmentAddForm` derives at add time, but always the FULL
 *  required arrays (`updateAccessoryPlanNative` replaces the whole plan, so
 *  "nothing overridden" is `{excluded: [], added: []}`, never `undefined`). */
function derivePlanToSave(
  accessories: ModelAccessoryDetail[],
  selection: Record<string, boolean>,
  excludeReasons: Record<string, string>,
): AccessoryPlanInput {
  const excludedRows = accessories.filter((a) => a.inclusion !== "OPTIONAL" && selection[a.id] === false);
  const added = accessories
    .filter((a) => a.inclusion === "OPTIONAL" && selection[a.id] === true)
    .map((a) => ({ bulkAssetId: a.bulkAssetId }));
  return {
    excluded: excludedRows.map((a) => a.bulkAssetId),
    added,
    excludedReasons: excludedRows.map((a) => ({ bulkAssetId: a.bulkAssetId, reason: excludeReasons[a.id] ?? "" })),
  };
}

/** Resolve the model/asset's configured accessory catalog for `item` — model
 *  rows via `checkAvailability` for a bulk/generic line, asset rows via
 *  `lookupAssetByTag` for a specific-serial line. Split out so the dialog's
 *  own body doesn't carry both queries' `enabled` branches (R-3.6). */
function useAccessoryCatalog(item: LineItemData | null): ModelAccessoryDetail[] {
  const isAssetBased = !!item?.assetId;
  const { data: modelAvailability } = useServerQuery({
    queryKey: ["edit-accessories-model", item?.modelId],
    queryFn: () => checkAvailability(item!.modelId!, null, null, undefined),
    enabled: !!item && !isAssetBased && !!item.modelId,
  });
  const { data: assetLookup } = useServerQuery({
    queryKey: ["edit-accessories-asset", item?.asset?.assetTag],
    queryFn: () => lookupAssetByTag(item!.asset!.assetTag!, undefined, undefined, undefined),
    enabled: !!item && isAssetBased && !!item.asset?.assetTag,
  });
  return useMemo(
    () => (isAssetBased ? (assetLookup?.accessories ?? []) : (modelAvailability?.accessories ?? [])),
    [isAssetBased, assetLookup, modelAvailability],
  );
}

/** Owns `selection`/`excludeReasons` and re-seeds them, DURING RENDER (React's
 *  documented alternative to an effect for "adjust state when a prop changes"
 *  — react.dev/learn/you-might-not-need-an-effect), whenever the target line
 *  or its loaded catalog+plan changes. Keyed on `item.id` + the catalog's own
 *  row ids so a same-model line reopened right after another still re-seeds,
 *  and gated on `lineDocLoaded` so neither query's mid-flight `undefined`
 *  clobbers a selection already seeded for this exact line. */
function useSeededAccessorySelection(
  item: LineItemData | null,
  accessories: ModelAccessoryDetail[],
  currentPlan: AccessoryPlanInput | undefined,
  lineDocLoaded: boolean,
) {
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});
  const [seededKey, setSeededKey] = useState<string | null>(null);

  const seedKey = item && lineDocLoaded && accessories.length > 0
    ? `${item.id}:${accessories.map((a) => a.id).join(",")}`
    : null;
  if (seedKey !== null && seedKey !== seededKey) {
    setSeededKey(seedKey);
    const seeded = seedAccessorySelection(accessories, currentPlan);
    setSelection(seeded.selection);
    setExcludeReasons(seeded.excludeReasons);
  }

  return { selection, setSelection, excludeReasons, setExcludeReasons };
}

export function EditAccessoryPlanDialog({ item, onClose }: EditAccessoryPlanDialogProps) {
  const lineItemWrites = useLineItemWrites();

  // The line's OWN current plan — not on LineItemData, so a fresh org-checked
  // read (projectLineItems.getById) rather than widening the whole equipment-tab
  // reconstruct pipeline for one field only this dialog needs.
  const lineDoc = useAuthedQuery(api.projectLineItems.getById, item ? { id: item.id } : "skip");
  const currentPlan = (lineDoc as { accessoryPlan?: AccessoryPlanInput } | null | undefined)?.accessoryPlan;

  const accessories = useAccessoryCatalog(item);
  const { selection, setSelection, excludeReasons, setExcludeReasons } = useSeededAccessorySelection(
    item,
    accessories,
    currentPlan,
    lineDoc !== undefined,
  );

  const planToSave = useMemo(
    () => derivePlanToSave(accessories, selection, excludeReasons),
    [accessories, selection, excludeReasons],
  );

  const mutation = useServerMutation({
    mutationFn: () => {
      if (!item) throw new Error("No line selected");
      return lineItemWrites.updateAccessoryPlan(item.id, planToSave);
    },
    onSuccess: () => {
      toast.success("Accessories updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit accessories</DialogTitle>
        </DialogHeader>
        {item && accessories.length === 0 ? (
          <p className="text-caption text-muted">
            {item.description ?? "This item"} has no configurable accessories.
          </p>
        ) : (
          <AccessorySelectionFields
            accessories={accessories}
            quantity={item?.quantity ?? 1}
            selection={selection}
            onSelectionChange={setSelection}
            excludeReasons={excludeReasons}
            onExcludeReasonsChange={setExcludeReasons}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!lineItemWrites.enabled || accessories.length === 0}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
