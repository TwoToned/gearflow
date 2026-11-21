/**
 * The ad-hoc check's condition words (D50, Phase 16) and their mapping onto the stored
 * `assets.condition` enum — one definition, shared by `checkRecordWrites.saveAdHocCheck`
 * and the Scan page (src imports this module, the `warehouseStage` precedent).
 *
 * The check offers three words; the enum has five values. Display (overseer Q5):
 *   NEW, GOOD (and absent) → Good · FAIR, POOR → Worn · DAMAGED → Damaged.
 * A check writes `assets.condition` ONLY when the chosen word maps to a different word
 * than the asset's current value, so checking a NEW asset "Good" leaves it NEW and a
 * POOR asset checked "Worn" stays POOR. `FAIR` reads **Worn** app-wide (glossary alias).
 */

export type CheckConditionWord = "Good" | "Worn" | "Damaged";
/** The three values a check may submit — the canonical value of each word. */
export type CheckConditionValue = "GOOD" | "FAIR" | "DAMAGED";
export type StoredAssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";

export const CHECK_CONDITION_VALUE: Record<CheckConditionWord, CheckConditionValue> = {
  Good: "GOOD",
  Worn: "FAIR",
  Damaged: "DAMAGED",
};

/** The word a stored condition reads as (absent reads Good). */
export function conditionWord(condition: StoredAssetCondition | null | undefined): CheckConditionWord {
  if (condition === "DAMAGED") return "Damaged";
  if (condition === "FAIR" || condition === "POOR") return "Worn";
  return "Good";
}

/**
 * The condition a check should store, or `null` for "write nothing". Any FAIL forces
 * DAMAGED whatever was chosen (server authority); no choice and no fail writes nothing.
 */
export function resolveCheckCondition(
  current: StoredAssetCondition | null | undefined,
  chosen: CheckConditionValue | null | undefined,
  anyFail: boolean,
): CheckConditionValue | null {
  const target: CheckConditionValue | null = anyFail ? "DAMAGED" : (chosen ?? null);
  if (!target) return null;
  return conditionWord(target) === conditionWord(current) ? null : target;
}
