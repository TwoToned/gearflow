import type { TotalLine } from "@/lib/primitives/types";

/**
 * The Equipment tab's footer totals (spec §5.6/§7). Every figure is the
 * project's STORED, recalc-owned anchor (`convex/lib/recalc.ts`): nothing is
 * re-summed on the client (R-3.1, FEATUREDOCS/74). A missing anchor is `null`
 * (rendered blank), never `0` (CLAUDE.md "$0 is a PRICE"). Money is formatted
 * by `FooterTotals`, not here.
 */
export interface ProjectTotalsSource {
  subtotal?: number | null;
  discountAmount?: number | null;
  taxAmount?: number | null;
  total?: number | null;
}

export function buildEquipmentFooterTotals(p: ProjectTotalsSource | null | undefined): TotalLine[] {
  if (!p || p.subtotal == null) return [];
  const lines: TotalLine[] = [{ label: "Subtotal", amount: p.subtotal }];
  if (p.discountAmount) lines.push({ label: "Discount", amount: -Math.abs(p.discountAmount) });
  lines.push({ label: "Tax", amount: p.taxAmount ?? null });
  lines.push({ label: "Total", amount: p.total ?? null });
  return lines;
}
