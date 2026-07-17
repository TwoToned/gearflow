import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Org-validate a client-supplied FK id against `by_cuid` (a GLOBAL index — the row could
 * belong to another org). Throws if the referenced row is missing or cross-org. Shared by
 * lineItemWrites.ts and projectWrites.ts — every table in the union carries `id` (by_cuid)
 * + `organizationId`.
 */
export async function assertRefInOrg(
  ctx: MutationCtx,
  table:
    | "models"
    | "assets"
    | "bulkAssets"
    | "projectGroups"
    | "projectCategories"
    | "clients"
    | "locations"
    | "suppliers"
    | "kits"
    | "categories"
    | "testProfiles"
    | "crewRoles"
    | "projectServices",
  id: string,
  orgId: string,
): Promise<void> {
  const doc = await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!doc || doc.organizationId !== orgId) {
    throw new ConvexError({ code: "FORBIDDEN", message: `Referenced ${table} not found in your organization.` });
  }
}
