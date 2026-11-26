import { blankToUndefined, changedEdit } from "@/lib/changed-edit";

/**
 * The Category Edit sheet's values and the write they become (UX Phase 14, 14b-5, D77). Pure, so the sheet and its tests
 * share ONE mapping. The sheet carries every field `categoriesEditWrites.editNative` sets and nothing else, including the
 * optional default Test & tag class and interval that the category's own models inherit unless they set their own.
 * A save sends only what CHANGED against the values the sheet opened with; a changed blank optional box CLEARS its field.
 */
export interface CategorySheetValues {
  name: string;
  /** "" = a top-level category. */
  parentId: string;
  description: string;
  icon: string;
  tags: string[];
  xeroAccountCode: string;
  /** "" = no default class. */
  defaultEquipmentClass: string;
  /** As typed; "" = no default interval. */
  defaultTestIntervalMonths: string;
}

/** The category as `categories.detail` returns it. */
export interface CategorySheetSource {
  id: string;
  name: string;
  parentId?: string | null;
  description?: string | null;
  icon?: string | null;
  tags?: string[] | null;
  xeroAccountCode?: string | null;
  defaultEquipmentClass?: string | null;
  defaultTestIntervalMonths?: number | null;
}

export interface CategorySheetInitial extends CategorySheetValues {
  id: string;
}

const text = (v: string | null | undefined): string => v ?? "";

export function categorySheetInitialOf(c: CategorySheetSource): CategorySheetInitial {
  return {
    id: c.id,
    name: c.name,
    parentId: text(c.parentId),
    description: text(c.description),
    icon: text(c.icon),
    tags: c.tags ?? [],
    xeroAccountCode: text(c.xeroAccountCode),
    defaultEquipmentClass: text(c.defaultEquipmentClass),
    defaultTestIntervalMonths: c.defaultTestIntervalMonths == null ? "" : String(c.defaultTestIntervalMonths),
  };
}

/** The one message that says what to fix, or `null` when the values are saveable (the server mirrors these bounds). */
export function categorySheetError(v: CategorySheetValues, selfId: string): string | null {
  if (!v.name.trim()) return "A category needs a name.";
  if (v.name.length > 100) return "The name can be at most 100 characters.";
  if (v.description.length > 500) return "The description can be at most 500 characters.";
  if (v.icon.length > 10) return "The icon can be at most 10 characters.";
  if (v.parentId === selfId) return "A category can't be its own parent.";
  const months = v.defaultTestIntervalMonths.trim();
  if (months !== "" && !(Number.isInteger(Number(months)) && Number(months) >= 1 && Number(months) <= 120)) return "The default test interval must be a whole number of months, 1 to 120.";
  return null;
}

const interval = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));

/** The edit write's input: ONLY the fields changed against `before` (what the sheet opened with). Never the id or the order. */
export function buildCategoryEdit(v: CategorySheetValues, before: CategorySheetValues) {
  return changedEdit([
    ["name", v.name.trim(), before.name.trim()],
    ["parentId", v.parentId || undefined, before.parentId || undefined],
    ["description", blankToUndefined(v.description), blankToUndefined(before.description)],
    ["icon", blankToUndefined(v.icon), blankToUndefined(before.icon)],
    ["tags", v.tags, before.tags],
    ["xeroAccountCode", blankToUndefined(v.xeroAccountCode), blankToUndefined(before.xeroAccountCode)],
    ["defaultEquipmentClass", v.defaultEquipmentClass || undefined, before.defaultEquipmentClass || undefined],
    ["defaultTestIntervalMonths", interval(v.defaultTestIntervalMonths), interval(before.defaultTestIntervalMonths)],
  ]);
}
