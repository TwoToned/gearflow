/**
 * The ONE resolver of a model's effective default Test & tag class and interval (UX Phase 14, 14b-5, D77).
 *
 * The owner approved exactly: an optional default class + interval on a CATEGORY, which its models inherit, and a model
 * can override. So per field: the model's OWN value wins; otherwise its OWN category's default (never a parent
 * category's: subcategory inheritance was not decided); otherwise nothing, and the caller applies its own fallback
 * (class `CLASS_I`, the org's default interval).
 *
 * Pure (no `ctx`), so the registration paths in Convex and the browser's Register form read the same answer.
 */
import type { Doc } from "../_generated/dataModel";

type EquipmentClass = NonNullable<Doc<"categories">["defaultEquipmentClass"]>;

/** The fields of a model this resolver reads (its own T&T overrides). */
export interface ModelTestDefaults {
  defaultEquipmentClass?: EquipmentClass | string | null;
  /** The model's own interval, in DAYS (the model form's unit); converted to months here. */
  testAndTagIntervalDays?: number | null;
}

/** The fields of a category this resolver reads. */
export interface CategoryTestDefaultsSource {
  defaultEquipmentClass?: EquipmentClass | string | null;
  defaultTestIntervalMonths?: number | null;
}

export type DefaultSource = "model" | "category" | null;

export interface EffectiveTestDefaults {
  equipmentClass: EquipmentClass | null;
  intervalMonths: number | null;
  classFrom: DefaultSource;
  intervalFrom: DefaultSource;
}

/** A model's interval in whole months (30-day months, at least 1), as every registration path has always converted it. */
export const daysToMonths = (days: number): number => Math.max(1, Math.round(days / 30));

export function effectiveTestDefaults(model: ModelTestDefaults, category: CategoryTestDefaultsSource | null | undefined): EffectiveTestDefaults {
  const modelClass = model.defaultEquipmentClass as EquipmentClass | null | undefined;
  const catClass = category?.defaultEquipmentClass as EquipmentClass | null | undefined;
  const modelMonths = model.testAndTagIntervalDays ? daysToMonths(model.testAndTagIntervalDays) : null;
  const catMonths = category?.defaultTestIntervalMonths || null;
  return {
    equipmentClass: modelClass || catClass || null,
    classFrom: modelClass ? "model" : catClass ? "category" : null,
    intervalMonths: modelMonths ?? catMonths,
    intervalFrom: modelMonths != null ? "model" : catMonths != null ? "category" : null,
  };
}
