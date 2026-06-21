import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * In-mutation Test & Tag compliance gate (Convex port of warehouse.ts
 * assertTestTagAllowsCheckout + testTagAssets.listBlockedForCheckout).
 *
 * The Prisma version called a Convex query mid-$transaction — which can't happen
 * inside a Convex mutation. Re-implemented against ctx.db so the checkout mutation
 * can assert compliance atomically at the exact points the original did (batch
 * preflight + per-accessory-unit). Throws ConvexError with a structured payload so
 * the server action can re-raise a UI-facing TestTagBlockError.
 */
export async function assertTestTagAllowsCheckout(
  ctx: MutationCtx,
  organizationId: string,
  options: { assetIds?: string[]; bulkAssetIds?: string[] },
): Promise<void> {
  const assetIds = (options.assetIds ?? []).filter(Boolean);
  const bulkAssetIds = (options.bulkAssetIds ?? []).filter(Boolean);
  if (assetIds.length === 0 && bulkAssetIds.length === 0) return;

  const assetSet = new Set(assetIds);
  const bulkSet = new Set(bulkAssetIds);
  const failed = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_status", (q) => q.eq("organizationId", organizationId).eq("status", "FAILED"))
    .filter((q) => q.eq(q.field("isActive"), true))
    .collect();
  const overdue = await ctx.db
    .query("testTagAssets")
    .withIndex("by_organizationId_status", (q) => q.eq("organizationId", organizationId).eq("status", "OVERDUE"))
    .filter((q) => q.eq(q.field("isActive"), true))
    .collect();
  const blocked = [...failed, ...overdue].filter(
    (r) =>
      (r.assetId != null && assetSet.has(r.assetId)) ||
      (r.bulkAssetId != null && bulkSet.has(r.bulkAssetId)),
  );
  if (blocked.length === 0) return;

  throw new ConvexError({
    kind: "TESTTAG_BLOCK",
    blocked: blocked.map((b) => ({
      assetId: b.assetId ?? null,
      bulkAssetId: b.bulkAssetId ?? null,
      testTagId: b.testTagId,
      status: b.status,
      nextDueDate: b.nextDueDate ?? null,
    })),
  });
}
