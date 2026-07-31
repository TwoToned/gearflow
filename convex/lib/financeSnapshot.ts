import type { MutationCtx } from "../_generated/server";

export interface FinanceSnapshotLine {
  sourceType: "EQUIPMENT" | "SERVICE" | "GROUP" | "CUSTOM";
  sourceLineItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

type ProjectLine = { kitId?: string; isKitChild?: boolean; modelId?: string };

/**
 * Equipment/kit lines are usually added by picking a model/kit, not by
 * typing a description — `structure-line-items.ts` (the PDF pipeline)
 * already knows this and resolves `model?.name ?? description` per line.
 * `buildFinanceLines` used to check ONLY `description`/`groupName`, so any
 * model-linked line with no hand-typed description (the common case) fell
 * straight through to the literal string "Line item" — that's what a
 * pushed Xero invoice showed instead of e.g. "USB Pro DI". Batch-fetch once
 * per unique id (deduped, org-checked — `by_cuid` is a GLOBAL index,
 * R-8.4.3) rather than per-line, since a project reuses the same handful of
 * models/kits across many lines. Split out purely to keep
 * `buildFinanceLines`'s own complexity manageable (R-3.6), same rationale
 * as `xeroPush.ts`'s per-source-type resolvers.
 */
async function resolveModelAndKitNames(
  ctx: MutationCtx,
  projectLines: ProjectLine[],
  orgId: string,
): Promise<{ modelNameById: Map<string, string>; kitNameById: Map<string, string> }> {
  const modelIds = new Set<string>();
  const kitIds = new Set<string>();
  for (const li of projectLines) {
    if (li.kitId && !li.isKitChild) kitIds.add(li.kitId);
    else if (li.modelId) modelIds.add(li.modelId);
  }
  const [modelDocs, kitDocs] = await Promise.all([
    Promise.all([...modelIds].map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first())),
    Promise.all([...kitIds].map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first())),
  ]);
  return {
    modelNameById: new Map(modelDocs.filter((m) => m && m.organizationId === orgId).map((m) => [m!.id, m!.name])),
    kitNameById: new Map(kitDocs.filter((k) => k && k.organizationId === orgId).map((k) => [k!.id, k!.name])),
  };
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
  orgId: string,
): Promise<FinanceSnapshotLine[]> {
  const [groups, projectLines, services] = await Promise.all([
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);

  const { modelNameById, kitNameById } = await resolveModelAndKitNames(ctx, projectLines, orgId);

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
    const modelOrKitName = li.kitId && !li.isKitChild ? kitNameById.get(li.kitId) : li.modelId ? modelNameById.get(li.modelId) : undefined;
    lines.push({
      sourceType: "EQUIPMENT",
      sourceLineItemId: li.id,
      description: li.description || modelOrKitName || li.groupName || "Line item",
      quantity: qty,
      unitPrice: Number(li.unitPrice) || 0,
      lineTotal: Number(li.lineTotal) || 0,
    });
  }

  for (const s of services) {
    if (s.status === "CANCELLED") continue;
    // A service only appears on a quote/invoice/Xero push once it has an actual
    // charge — `lineTotal` is null/0 until a unitPrice is typed or a crew charge
    // rate auto-prices it (calculateServiceLineTotal / recalcServiceChargeFromCrew).
    // Mirrors recalcProjectTotals's serviceRevenue (convex/lib/recalc.ts), which
    // sums the SAME lineTotal unconditionally — a $0/unset service already
    // contributes nothing there, so this is the same rule, not a second one.
    const lineTotal = Number(s.lineTotal) || 0;
    if (lineTotal <= 0) continue;
    lines.push({
      sourceType: "SERVICE",
      sourceLineItemId: s.id,
      description: s.title || s.type,
      quantity: s.quantity ?? 1,
      unitPrice: Number(s.unitPrice) || 0,
      lineTotal,
    });
  }

  return lines;
}
