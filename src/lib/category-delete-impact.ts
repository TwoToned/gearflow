import { formatCurrency } from "@/lib/formatters";

/**
 * What `projectCategoriesWrites.deleteCategoryNative` does, as read from the
 * loaded category: every line in it (loose or inside one of its Project
 * Groups) is moved to Uncategorized, and each Project Group is DELETED (its
 * bundle price goes with it; the members stay as loose lines). Sub-hire group
 * targets are not touched by that mutation. Pure: the dialog and its test share it.
 */
export interface CategoryDeleteInput {
  name: string;
  groups: { title: string; price: unknown; lineItems?: unknown[] }[];
  lineItems?: unknown[];
}

export interface CategoryDeleteImpact {
  lineCount: number;
  groupCount: number;
  /** Sum of the groups' bundle prices that disappear (`null` = no priced group). */
  bundleTotal: number | null;
}

export function categoryDeleteImpact(cat: CategoryDeleteInput): CategoryDeleteImpact {
  const loose = cat.lineItems?.length ?? 0;
  const inGroups = cat.groups.reduce((n, g) => n + (g.lineItems?.length ?? 0), 0);
  const priced = cat.groups.map((g) => Number(g.price)).filter((p) => Number.isFinite(p) && p > 0);
  return {
    lineCount: loose + inGroups,
    groupCount: cat.groups.length,
    bundleTotal: priced.length ? priced.reduce((a, b) => a + b, 0) : null,
  };
}

/** The sentence(s) the confirm dialog shows; says what happens downstream. */
export function categoryDeleteBody(impact: CategoryDeleteImpact): string[] {
  const out = [
    impact.lineCount === 0
      ? "The category is empty, so no lines move."
      : `${impact.lineCount} line${impact.lineCount === 1 ? "" : "s"} will move to Uncategorized and keep their prices.`,
  ];
  if (impact.groupCount > 0) {
    const price = impact.bundleTotal != null ? ` and their ${formatCurrency(impact.bundleTotal)} of bundle pricing` : "";
    out.push(
      `${impact.groupCount} group${impact.groupCount === 1 ? "" : "s"} will be deleted${price}; their members stay as separate lines.`,
    );
  }
  out.push("A category price rollup on documents stops applying. Quotes already sent keep their copy.");
  return out;
}
