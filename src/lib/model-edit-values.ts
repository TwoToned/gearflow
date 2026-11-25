import type { ModelFormValues } from "@/lib/validations/model";

/**
 * The ONE mapping from a stored model (`models.detail`) to the edit sheet's form values
 * (UX Phase 12 slice 3). Every field the write sets is here: the write treats an absent
 * value as "clear it", so an edit form that forgot a field (rates, sale price) would
 * silently wipe it on save. A plain module so the sheet and its test share it.
 */
interface StoredModel {
  id: string;
  name: string;
  manufacturer?: string | null;
  modelNumber?: string | null;
  sku?: string | null;
  categoryId?: string | null;
  description?: string | null;
  image?: string | null;
  images?: string[] | null;
  manuals?: string[] | null;
  specifications?: unknown;
  customFields?: unknown;
  defaultRentalPrice?: number | null;
  dailyRate?: number | null;
  weeklyRate?: number | null;
  monthlyRate?: number | null;
  defaultPurchasePrice?: number | null;
  replacementCost?: number | null;
  salePrice?: number | null;
  saleStockQuantity?: number | null;
  weight?: number | null;
  powerDraw?: number | null;
  requiresTestAndTag?: boolean | null;
  testAndTagIntervalDays?: number | null;
  defaultTestProfileId?: string | null;
  defaultEquipmentClass?: ModelFormValues["defaultEquipmentClass"] | null;
  defaultApplianceType?: ModelFormValues["defaultApplianceType"] | null;
  assetType?: "SERIALIZED" | "BULK" | null;
  barcodeLabelTemplate?: string | null;
  isActive?: boolean | null;
  isContainer?: boolean | null;
  tags?: string[] | null;
  xeroRentalAccountCode?: string | null;
  xeroSaleAccountCode?: string | null;
}

type Key = keyof StoredModel;
/** Text boxes: a stored null / absent is an empty box. */
const TEXT_KEYS: Key[] = ["manufacturer", "modelNumber", "sku", "categoryId", "description", "image", "barcodeLabelTemplate"];
/** Numbers where `0` is a REAL value (a free model); only null / absent mean "not set". */
const NUMBER_KEYS: Key[] = [
  "defaultRentalPrice", "dailyRate", "weeklyRate", "monthlyRate", "defaultPurchasePrice", "replacementCost",
  "salePrice", "saleStockQuantity", "weight", "powerDraw",
];
/** Optional picks where a falsy stored value (0, "") also means "not set". */
const BLANK_KEYS: Key[] = [
  "testAndTagIntervalDays", "defaultTestProfileId", "defaultEquipmentClass", "defaultApplianceType",
  "xeroRentalAccountCode", "xeroSaleAccountCode",
];

const entries = (m: StoredModel, keys: Key[], pick: (v: unknown) => unknown) => keys.map((k) => [k, pick(m[k])] as const);

export function modelToFormValues(m: StoredModel): ModelFormValues & { id: string } {
  return {
    ...Object.fromEntries([
      ...entries(m, TEXT_KEYS, (v) => v ?? ""),
      ...entries(m, NUMBER_KEYS, (v) => v ?? undefined),
      ...entries(m, BLANK_KEYS, (v) => v || undefined),
    ]),
    id: m.id,
    name: m.name,
    images: m.images ?? [],
    manuals: m.manuals ?? [],
    specifications: (m.specifications as Record<string, string> | undefined) ?? {},
    customFields: (m.customFields as Record<string, string> | undefined) ?? {},
    requiresTestAndTag: m.requiresTestAndTag ?? false,
    assetType: m.assetType ?? "SERIALIZED",
    isActive: m.isActive ?? true,
    isContainer: m.isContainer ?? false,
    tags: m.tags ?? [],
  };
}
