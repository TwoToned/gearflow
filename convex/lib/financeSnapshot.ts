import type { MutationCtx } from "../_generated/server";

export interface FinanceSnapshotLine {
  sourceType: "EQUIPMENT" | "SERVICE" | "GROUP" | "CUSTOM";
  sourceLineItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Build the client-facing line breakdown for a project's CURRENT pricing —
 * the single shared builder behind both `Quote.snapshot` (publish) and
 * `Invoice`/`InvoiceLine` snapshots (create). Deliberately mirrors
 * `recalcProjectTotals`'s own revenue-counting rules (`convex/lib/recalc.ts`)
 * so a quote/invoice's lines always sum to the totals recalc already stored
 * on the project — one definition of "what's billable" (R-3.1), not a second
 * hand-maintained copy.
 *
 * This is the DATA-MODEL snapshot (what a Quote/Invoice row remembers), not
 * the PDF's own line-item structuring (`structure-line-items.ts`) — that
 * pipeline stays exactly as-is (kit boundaries, sub-hire sections, packer
 * sort, etc. are PDF presentation concerns, out of scope for this entity).
 */
export async function buildFinanceLines(
  ctx: MutationCtx,
  projectId: string,
): Promise<FinanceSnapshotLine[]> {
  const [groups, projectLines, services] = await Promise.all([
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);

  const lines: FinanceSnapshotLine[] = [];

  // Priced groups bill as ONE line — a priced group's flat price is the whole
  // charge for everything inside it (mirrors recalcProjectTotals equipmentRevenue).
  const pricedGroupIds = new Set<string>();
  for (const g of groups) {
    const bundlePrice = Number(g.price) || 0;
    if (bundlePrice <= 0) continue;
    pricedGroupIds.add(g.id);
    const qty = g.quantity ?? 1;
    const total = Math.max(0, bundlePrice * qty - (Number(g.discount) || 0));
    lines.push({
      sourceType: "GROUP",
      sourceLineItemId: g.id,
      description: g.title ?? "Group",
      quantity: qty,
      unitPrice: bundlePrice,
      lineTotal: total,
    });
  }

  for (const li of projectLines) {
    if (li.isKitChild || li.isOptional || li.status === "CANCELLED") continue;
    if (li.groupId && pricedGroupIds.has(li.groupId)) continue; // rolled into the group's flat price above
    if (li.groupId && !pricedGroupIds.has(li.groupId) && !li.isCustomItem && li.subHireId == null) {
      // Member of an UNPRICED group that isn't a custom-item extra or a
      // sub-hire charge — recalc doesn't bill this on its own either (only
      // isCustomItem extras + grouped sub-hire charges count for an unpriced
      // group), so it doesn't get its own snapshot line.
      continue;
    }
    const qty = li.quantity ?? 1;
    lines.push({
      sourceType: "EQUIPMENT",
      sourceLineItemId: li.id,
      description: li.description || li.groupName || "Line item",
      quantity: qty,
      unitPrice: Number(li.unitPrice) || 0,
      lineTotal: Number(li.lineTotal) || 0,
    });
  }

  for (const s of services) {
    if (s.status === "CANCELLED" || s.showOnDocuments !== true) continue;
    lines.push({
      sourceType: "SERVICE",
      sourceLineItemId: s.id,
      description: s.title || s.type,
      quantity: s.quantity ?? 1,
      unitPrice: Number(s.unitPrice) || 0,
      lineTotal: Number(s.lineTotal) || 0,
    });
  }

  return lines;
}
