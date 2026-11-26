import type { ColorIntent } from "@/lib/status-colors";

/**
 * A category's DERIVED words (UX Phase 14, 14b-5, section 9n.2): the header word and what Delete will do. Nothing stored:
 * the counts come from the live record read. Pure: the page and the tests read it.
 */
export interface CategoryCounts {
  models: number;
  kits: number;
  children: number;
}

interface RatedModel {
  dailyRate?: number | null;
  weeklyRate?: number | null;
}

/** Models with no sell rate at all (a model with a rate of 0 HAS a rate: 0 is a price, not a blank). */
export const modelsWithoutRates = (models: RatedModel[]): number => models.filter((m) => m.dailyRate == null && m.weeklyRate == null).length;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `2 models without rates` (warning) when any model has no rate; otherwise `12 models` or `Empty`. */
export function categoryStateWord(counts: CategoryCounts, unrated: number): { label: string; intent: ColorIntent; outline?: boolean } {
  if (unrated > 0) return { label: `${plural(unrated, "model")} without rates`, intent: "warning" };
  if (counts.models + counts.kits + counts.children === 0) return { label: "Empty", intent: "neutral", outline: true };
  return { label: plural(counts.models, "model"), intent: "neutral" };
}

/** What Delete does to what is inside the category, in words (the confirm names it). */
export function deleteEffectText(counts: CategoryCounts, parentName: string | null): string {
  const parts: string[] = [];
  if (counts.models + counts.kits > 0) {
    const things = [counts.models > 0 ? plural(counts.models, "model") : "", counts.kits > 0 ? plural(counts.kits, "kit") : ""].filter(Boolean).join(" and ");
    parts.push(`${things} become Uncategorised`);
  }
  if (counts.children > 0) parts.push(`${counts.children} subcategor${counts.children === 1 ? "y" : "ies"} move up to ${parentName ?? "the top level"}`);
  return parts.length ? `${parts.join("; ")}. You can undo it from the toast.` : "It is empty, so nothing else changes. You can undo it from the toast.";
}
