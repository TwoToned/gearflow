"use client";

/**
 * The stateful half of the post-add accessory picker: resolves a line's
 * accessory catalog + its stored `accessoryPlan`, seeds the checkbox state from
 * them, and derives the plan to save.
 *
 * Two consumers (R-3.1 — one definition, two entry points):
 *   - `EditAccessoryPlanDialog` — the row kebab's standalone "Edit accessories".
 *   - `EditLineItemDialog` — the Accessories section inside the Edit Item
 *     window, saved alongside the rest of the line.
 *
 * `enabled` mirrors `canEditAccessoryPlan` at the call site so neither query
 * fires for a line that can't have a plan (a service line, a kit child, an
 * already-deployed line). Server-side `assertLineOwnsAccessoryPlan` remains the
 * authority — this is UX only.
 */

import { useMemo, useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { api } from "../../../convex/_generated/api";
import { checkAvailability, lookupAssetByTag, type ModelAccessoryDetail } from "@/server/line-items";
import type { AccessoryPlanInput } from "@/hooks/use-line-item-writes";
import {
  accessoryPlansEqual,
  derivePlanToSave,
  seedAccessorySelection,
} from "@/lib/accessory-plan-editor";
import type { LineItemData } from "./equipment-row-types";

export interface AccessoryPlanEditor {
  /** The model/asset's configured accessory rows. Empty while loading, or when
   *  the model has none configured (render no section in that case). */
  accessories: ModelAccessoryDetail[];
  selection: Record<string, boolean>;
  setSelection: (next: Record<string, boolean>) => void;
  excludeReasons: Record<string, string>;
  setExcludeReasons: (next: Record<string, string>) => void;
  /** The full plan the current checkboxes describe. */
  planToSave: AccessoryPlanInput;
  /** True once the line's own plan has loaded AND the checkboxes describe a
   *  different set of children than it does. Callers save only when true. */
  isDirty: boolean;
  /** False until the line's stored plan has come back — the checkboxes aren't
   *  meaningful (and `isDirty` is never true) before that. */
  loaded: boolean;
}

/** Resolve the model/asset's configured accessory catalog for `item` — model
 *  rows via `checkAvailability` for a bulk/generic line, asset rows via
 *  `lookupAssetByTag` for a specific-serial line. Split out so the callers'
 *  bodies don't carry both queries' `enabled` branches (R-3.6). */
function useAccessoryCatalog(item: LineItemData | null, enabled: boolean): ModelAccessoryDetail[] {
  const isAssetBased = !!item?.assetId;
  const { data: modelAvailability } = useServerQuery({
    queryKey: ["edit-accessories-model", item?.modelId],
    queryFn: () => checkAvailability(item!.modelId!, null, null, undefined),
    enabled: enabled && !!item && !isAssetBased && !!item.modelId,
  });
  const { data: assetLookup } = useServerQuery({
    queryKey: ["edit-accessories-asset", item?.asset?.assetTag],
    queryFn: () => lookupAssetByTag(item!.asset!.assetTag!, undefined, undefined, undefined),
    enabled: enabled && !!item && isAssetBased && !!item.asset?.assetTag,
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

  return { selection, setSelection, excludeReasons, setExcludeReasons, seeded: seedKey !== null && seedKey === seededKey };
}

export function useAccessoryPlanEditor(
  item: LineItemData | null,
  enabled = true,
): AccessoryPlanEditor {
  // The line's OWN current plan — not on LineItemData, so a fresh org-checked
  // read (projectLineItems.getById) rather than widening the whole equipment-tab
  // reconstruct pipeline for one field only these pickers need.
  const lineDoc = useAuthedQuery(api.projectLineItems.getById, item && enabled ? { id: item.id } : "skip");
  const currentPlan = (lineDoc as { accessoryPlan?: AccessoryPlanInput } | null | undefined)?.accessoryPlan;

  const accessories = useAccessoryCatalog(item, enabled);
  const { selection, setSelection, excludeReasons, setExcludeReasons, seeded } = useSeededAccessorySelection(
    item,
    accessories,
    currentPlan,
    lineDoc !== undefined,
  );

  const planToSave = useMemo(
    () => derivePlanToSave(accessories, selection, excludeReasons),
    [accessories, selection, excludeReasons],
  );

  return {
    accessories,
    selection,
    setSelection,
    excludeReasons,
    setExcludeReasons,
    planToSave,
    loaded: seeded,
    isDirty: seeded && !accessoryPlansEqual(currentPlan, planToSave),
  };
}
