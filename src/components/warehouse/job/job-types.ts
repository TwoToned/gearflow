import type { LineItem } from "@/components/warehouse/warehouse-types";
import type { useStageMutations } from "@/components/warehouse/job/use-stage-mutations";
import type { useCheckQueue } from "@/components/warehouse/job/use-check-queue";
import type { useWarehouseWrites } from "@/hooks/use-warehouse-writes";

/** An accessory that would be left behind by a Deploy (the gate's row, before it is shown). */
export interface MissingAccessory {
  parentLineItemId: string; parentName: string; accessoryLineItemId: string; accessoryName: string;
  tier: "DEFAULT" | "OPTIONAL"; officeNote: string;
}

export type ReturnConditionValue = "GOOD" | "DAMAGED" | "MISSING";

/** One line of a Deploy batch. */
export interface CheckOutItem { lineItemId: string; assetId?: string; quantity?: number; includeAccessoryIds?: string[] }

/** The kit "verify before prep/return" confirm (single slot; the rest wait in a backlog). */
export type KitConfirmState = {
  action: "deploy" | "return";
  kitName: string;
  kitId: string;
  parentLineItemId: string;
  verifiedCount: number;
  totalCount: number;
  verifiedIds: string[];
  durableOperationId?: string;
};

/** The missing-accessory gate: soft-blocks Deploy until every row is decided. */
export interface AccessoryGateState {
  durableOperationId?: string;
  pendingCheckOutItems: CheckOutItem[];
  missingDefaults: MissingAccessory[];
  missingOptionals: MissingAccessory[];
}

/** The partial-verification confirm ("Deploy Verified Only" vs "Deploy All"). */
export interface AccessoryVerifyState {
  durableOperationId?: string;
  parentLineItemId: string;
  parentAssetId?: string;
  parentName: string;
  verifiedCount: number;
  totalCount: number;
  /** Verified accessories' own asset/bulkAsset identities (what `includeAccessoryIds` narrows by). */
  verifiedAccessoryIds: string[];
}

export interface PickerRow {
  lineItemId: string; modelId: string; modelName: string;
  availableAssets: import("@/components/warehouse/warehouse-types").AvailableAsset[];
  selectedAssetId: string; checkItemCount: number;
}

export type StageMutations = ReturnType<typeof useStageMutations>;
export type CheckFlow = ReturnType<typeof useCheckQueue>;
export type WarehouseWrites = ReturnType<typeof useWarehouseWrites>;
export type JobLineItem = LineItem;
