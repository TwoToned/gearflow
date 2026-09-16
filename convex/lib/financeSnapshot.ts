import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { versionRows, resolveVersionId, resolveEffectiveProjectForVersion } from "./versionScope";

export interface FinanceSnapshotLine {
  /** Mirrors `enums.InvoiceLineSourceType` (convex/lib/validators.ts).
   *  `CATEGORY` is a `pricingDisplay: "ROLLUP"` project category billed as one
   *  line covering everything inside it — see the rollup fold in
   *  `buildFinanceLines` and src/lib/category-pricing-display.ts. */
  sourceType: "EQUIPMENT" | "SERVICE" | "GROUP" | "CATEGORY" | "CUSTOM";
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
 * Category price rollup: the `ROLLUP` categories this project's rows actually
 * reference, by cuid -> display name. A category set to `ROLLUP` bills as ONE
 * line covering everything inside it — the finance counterpart of the single
 * subtotal the quote/invoice PDF prints on that section's header, so the
 * document a client holds and the invoice they're billed from are grouped the
 * same way (the amount is identical either way: rollup only regroups, it never
 * reprices). See src/lib/category-pricing-display.ts.
 *
 * Fetches only the categories REFERENCED by the project's groups/lines, deduped,
 * rather than scanning every category on the project: a project reuses the same
 * handful of categories across many rows, so this reads strictly less, and it
 * keeps the whole-repo collect-scan ratchet (#860) flat — an indexed narrowing
 * is what that ratchet asks for in place of a new whole-table scan. (That
 * ratchet text-matches per line and does not strip comments, so this note
 * deliberately avoids spelling the call token.) Split out for the same reason
 * `resolveModelAndKitNames` above is.
 *
 * `by_cuid` is a GLOBAL index, so every hit is checked against BOTH the caller's
 * org (R-8.4.3) and this project before it is trusted — without those, another
 * org's (or another project's) category row could decide how this project bills.
 */
async function resolveRollupCategoryNames(
  ctx: MutationCtx,
  groups: Array<{ categoryId?: string }>,
  projectLines: Array<{ categoryId?: string }>,
  projectId: string,
  orgId: string,
): Promise<Map<string, string>> {
  const categoryIds = new Set<string>();
  for (const g of groups) if (g.categoryId) categoryIds.add(g.categoryId);
  for (const li of projectLines) if (li.categoryId) categoryIds.add(li.categoryId);
  if (categoryIds.size === 0) return new Map();

  const docs = await Promise.all(
    [...categoryIds].map((id) =>
      ctx.db.query("projectCategories").withIndex("by_cuid", (q) => q.eq("id", id)).first(),
    ),
  );
  return new Map(
    docs
      .filter(
        (c) =>
          c &&
          c.organizationId === orgId &&
          // Also pin to THIS project: a by_cuid hit is not project-scoped the way
          // the by_projectId scan this replaced implicitly was, and a row whose
          // categoryId pointed at another project's category would otherwise
          // decide how this project bills.
          c.projectId === projectId &&
          c.pricingDisplay === "ROLLUP",
      )
      .map((c) => [c!.id, c!.name]),
  );
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
 *
 * #1233 (Phase 6) — `versionId` (optional, defaults to the project's live
 * version, same "optional/default-live" shape every other version-aware read
 * in this codebase takes — `versionScope.ts`'s `resolveVersionId`) lets
 * `quotesWrites.sendNative` freeze a NON-live version's own lines/pricing,
 * not just the live plan's. An invoice snapshot (`invoicesWrites.ts`) never
 * passes one — invoices remain LIVE-ONLY, unaffected.
 */
export async function buildFinanceLines(
  ctx: MutationCtx,
  projectId: string,
  orgId: string,
  versionId?: string,
): Promise<FinanceSnapshotLine[]> {
  // `by_cuid` is GLOBAL — org-checked below like every other lookup here.
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== orgId) {
    throw new ConvexError(`buildFinanceLines: project not found or cross-org: ${projectId}`);
  }
  const targetVersionId = resolveVersionId(project, versionId);
  // #1233 — the target version's OWN discountPercent (below) wins over the
  // live project's. No-op (same object) when targetVersionId IS live.
  const effectiveProject = await resolveEffectiveProjectForVersion(ctx, project, targetVersionId);
  const [groups, projectLines, services] = await Promise.all([
    versionRows(ctx, "projectGroups", targetVersionId),
    versionRows(ctx, "projectLineItems", targetVersionId),
    versionRows(ctx, "projectServices", targetVersionId),
  ]);

  const { modelNameById, kitNameById } = await resolveModelAndKitNames(ctx, projectLines, orgId);
  const rollupCategoryNames = await resolveRollupCategoryNames(ctx, groups, projectLines, projectId, orgId);

  const groupCategoryById = new Map<string, string | null>(groups.map((g) => [g.id, g.categoryId ?? null]));

  /** The rolled-up category that will absorb this source row's charge, or null.
   *  A grouped line's OWN `categoryId` can legitimately be null while its group
   *  carries the category (a member can sit in a group without being filed under
   *  the category itself), so fall back to the group's — the same "groupId is the
   *  authoritative FK" reasoning `structure-line-items.ts` documents. */
  const rollupCategoryFor = (row: { categoryId?: string; groupId?: string }): string | null => {
    const catId = row.categoryId ?? (row.groupId ? groupCategoryById.get(row.groupId) ?? null : null);
    return catId && rollupCategoryNames.has(catId) ? catId : null;
  };

  /** Every line in emission order, each tagged with the rolled-up category that
   *  absorbs it (or null for the ones that bill on their own). One list rather
   *  than two parallel arrays so a line and its tag cannot drift apart. */
  const tagged: Array<{ line: FinanceSnapshotLine; rollupCategoryId: string | null }> = [];
  const emit = (line: FinanceSnapshotLine, rollupCategoryId: string | null = null) => {
    tagged.push({ line, rollupCategoryId });
  };

  // Priced groups bill as ONE line — a priced group's flat price is the whole
  // charge for everything inside it (mirrors recalcProjectTotals equipmentRevenue).
  const pricedGroupIds = new Set<string>();
  for (const g of groups) {
    const bundlePrice = Number(g.price) || 0;
    if (bundlePrice <= 0) continue;
    pricedGroupIds.add(g.id);
    const qty = g.quantity ?? 1;
    const total = Math.max(0, bundlePrice * qty - (Number(g.discount) || 0));
    emit(
      {
        sourceType: "GROUP",
        sourceLineItemId: g.id,
        description: g.title ?? "Group",
        quantity: qty,
        unitPrice: bundlePrice,
        lineTotal: total,
      },
      rollupCategoryFor({ categoryId: g.categoryId }),
    );
  }

  for (const li of projectLines) {
    if (li.isKitChild || li.isOptional || li.status === "CANCELLED") continue;
    // A priced group's flat price covers its OWN gear, so its members don't
    // bill separately — EXCEPT a sub-hire line, which carries its own client
    // charge independent of the host group's bundle price. `recalc.ts`'s
    // `subHireGroupedRevenue` counts exactly that (it filters on `groupId !=
    // null && subHireId != null` with NO priced-group exclusion, pinned by
    // `recalc.test.ts` "counts a sub-hire line placed inside a priced project
    // group (issue #8)"), so dropping it here put this snapshot permanently
    // BELOW `projects.subtotal` for any project with one. Two consequences,
    // the first of which shipped silently for as long as the Xero push has
    // existed:
    //   - the pushed Xero invoice UNDER-billed by the sub-hire's charge;
    //   - once `assertLinesReconcileWithSubtotal` (src/server/xero.ts) started
    //     enforcing `sum(lineTotal) === subtotal`, every such invoice became
    //     unpushable, with a "void and reissue" remedy that regenerates the
    //     same short lines.
    if (li.groupId && pricedGroupIds.has(li.groupId) && li.subHireId == null) continue;
    if (li.groupId && !pricedGroupIds.has(li.groupId) && !li.isCustomItem && li.subHireId == null) {
      // Member of an UNPRICED group that isn't a custom-item extra or a
      // sub-hire charge — recalc doesn't bill this on its own either (only
      // isCustomItem extras + grouped sub-hire charges count for an unpriced
      // group), so it doesn't get its own snapshot line.
      continue;
    }
    const qty = li.quantity ?? 1;
    const modelOrKitName = li.kitId && !li.isKitChild ? kitNameById.get(li.kitId) : li.modelId ? modelNameById.get(li.modelId) : undefined;
    emit(
      {
        sourceType: "EQUIPMENT",
        sourceLineItemId: li.id,
        description: li.description || modelOrKitName || li.groupName || "Line item",
        quantity: qty,
        unitPrice: Number(li.unitPrice) || 0,
        lineTotal: Number(li.lineTotal) || 0,
      },
      rollupCategoryFor({ categoryId: li.categoryId, groupId: li.groupId }),
    );
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
    // A service has no category — it is never absorbed by a rollup.
    emit({
      sourceType: "SERVICE",
      sourceLineItemId: s.id,
      description: s.title || s.type,
      quantity: s.quantity ?? 1,
      unitPrice: Number(s.unitPrice) || 0,
      lineTotal,
    });
  }

  // Fold each rolled-up category's member lines into ONE line, placed where its
  // FIRST member would have appeared so the surrounding order is untouched. The
  // rolled-up line's total is the plain sum of the members it replaces, which is
  // what keeps the snapshot summing to the SAME project totals `recalc.ts`
  // already stored — rollup is a grouping, not a repricing (R-3.1).
  const lines: FinanceSnapshotLine[] = [];
  const rolledUpTotals = new Map<string, number>();
  const rollupSlot = new Map<string, number>();
  for (const { line, rollupCategoryId } of tagged) {
    if (rollupCategoryId == null) {
      lines.push(line);
      continue;
    }
    rolledUpTotals.set(rollupCategoryId, (rolledUpTotals.get(rollupCategoryId) ?? 0) + line.lineTotal);
    if (!rollupSlot.has(rollupCategoryId)) {
      rollupSlot.set(rollupCategoryId, lines.length);
      // Placeholder: the real figures are only known once every member has been
      // seen, so reserve the position now and fill it in below.
      lines.push({
        sourceType: "CATEGORY",
        sourceLineItemId: rollupCategoryId,
        description: rollupCategoryNames.get(rollupCategoryId) ?? "Category",
        // One charge for the whole category — a quantity here would imply a
        // per-unit rate the category doesn't have (same shape a priced group's
        // bundle line uses when its own quantity is 1).
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
      });
    }
  }
  for (const [categoryId, slot] of rollupSlot) {
    const total = rolledUpTotals.get(categoryId) ?? 0;
    lines[slot] = { ...lines[slot], unitPrice: total, lineTotal: total };
  }

  // The PROJECT-level discount, as its own negative line.
  //
  // `recalc.ts` applies `discountPercent` AFTER summing the rows above
  // (`discountAmount = round(subtotal * pct/100)`, `taxableAmount = subtotal -
  // discountAmount`), and `invoices` has no discount column — so without this
  // line the snapshot sums to the PRE-discount figure while the invoice's
  // `total` is post-discount. The Xero push sends these lines as
  // tax-exclusive `LineAmount`s, so a discounted project was billed the
  // pre-discount base plus tax on it: a $1000 + 10% discount project issued
  // by Flow at $990 arrived in Xero at $1100. Same defect class as the
  // GST-inclusive deposit line (INV-260901), one level up.
  //
  // Emitted last so it reads as a deduction from everything above it, and
  // never folded into a rollup category — it belongs to the whole project,
  // not to one section.
  const discountPercent = Number(effectiveProject.discountPercent) || 0;
  if (discountPercent > 0) {
    const gross = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
    const discountAmount = round2(gross * (discountPercent / 100));
    if (discountAmount > 0) {
      lines.push({
        sourceType: "CUSTOM",
        description: `Discount (${discountPercent}%)`,
        quantity: 1,
        unitPrice: -discountAmount,
        lineTotal: -discountAmount,
      });
    }
  }

  return lines;
}

/** Mirrors `recalc.ts`'s `round` so the discount computed here lands on the
 *  same cent the project's stored `discountAmount` did. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
