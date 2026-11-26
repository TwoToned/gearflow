import type { KitFormValues } from "@/lib/validations/kit";

/** A kit's own fields as the Kit sheet edits or duplicates them (status, photos and the flags are not the sheet's). */
export type KitSheetInitial = Pick<
  KitFormValues,
  "name" | "assetTag" | "description" | "categoryId" | "condition" | "locationId" | "weight" | "caseType" | "caseDimensions" | "notes" | "purchaseDate" | "purchasePrice" | "tags" | "checkMode" | "xeroAccountCode"
> & { id: string };

/** The kit as a read returns it (every optional field may be absent or `null`). */
export interface KitSheetSource {
  id: string;
  name: string;
  assetTag: string;
  description?: string | null;
  categoryId?: string | null;
  condition: string;
  locationId?: string | null;
  weight?: number | string | null;
  caseType?: string | null;
  caseDimensions?: string | null;
  notes?: string | null;
  /** Epoch ms. */
  purchaseDate?: number | null;
  purchasePrice?: number | string | null;
  tags?: string[] | null;
  checkMode?: string | null;
  xeroAccountCode?: string | null;
}

/** A stored number: `0` is a real value (a weightless case, a free kit), only absent / null is blank. */
const num = (n: number | string | null | undefined): number | undefined => (n == null || n === "" ? undefined : Number(n));

/** Epoch ms as the `yyyy-mm-dd` a date input shows (the UTC day, which is how the save stored it). */
export function dateInputValue(ms: number | null | undefined): string | undefined {
  return ms == null ? undefined : new Date(ms).toISOString().slice(0, 10);
}

/**
 * The Kit sheet's starting values from a kit read. One mapping for the record page's Edit and Duplicate: a stored `0`
 * stays `0` (it must survive an unchanged save, never read as "cleared"), and a blank is blank.
 */
export function kitSheetInitialOf(kit: KitSheetSource): KitSheetInitial {
  return {
    id: kit.id,
    name: kit.name,
    assetTag: kit.assetTag,
    description: kit.description || undefined,
    categoryId: kit.categoryId || undefined,
    condition: kit.condition as KitSheetInitial["condition"],
    locationId: kit.locationId || undefined,
    weight: num(kit.weight),
    caseType: kit.caseType || undefined,
    caseDimensions: kit.caseDimensions || undefined,
    notes: kit.notes || undefined,
    purchaseDate: dateInputValue(kit.purchaseDate),
    purchasePrice: num(kit.purchasePrice),
    tags: kit.tags ?? [],
    checkMode: (kit.checkMode || "KIT_LEVEL") as "KIT_LEVEL" | "PER_ITEM",
    xeroAccountCode: kit.xeroAccountCode || undefined,
  };
}
