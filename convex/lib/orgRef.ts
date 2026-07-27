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
    | "supplierOrders"
    | "kits"
    | "categories"
    | "testProfiles"
    | "crewRoles"
    | "projectServices"
    | "fileUploads"
    | "projects"
    | "invoices",
  id: string,
  orgId: string,
): Promise<void> {
  const doc = await ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!doc || doc.organizationId !== orgId) {
    throw new ConvexError({ code: "FORBIDDEN", message: `Referenced ${table} not found in your organization.` });
  }
}

/**
 * Org + belongs-to-client validate a project's `clientContactId` (WS9 #948) — the
 * contact must exist, belong to the caller's org, AND belong to the SAME client the
 * project is being pointed at. Without the client check, a caller could pin a
 * project at contact X (client A) while setting clientId to client B, silently
 * mixing the two clients' PII on documents.
 */
export async function assertClientContactBelongsToClient(
  ctx: MutationCtx,
  contactId: string,
  clientId: string,
  orgId: string,
): Promise<void> {
  const doc = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", contactId)).first();
  if (!doc || doc.organizationId !== orgId || doc.clientId !== clientId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Referenced client contact not found on this project's client." });
  }
}

/**
 * Org-validate a client-supplied USER-id FK (reportedById/assignedToId/linked userId) —
 * the Better-Auth `user` table has no organizationId, so membership is checked via the
 * `member` table's global `by_org_user` index. Throws if the user is not a member of the
 * caller's org (prevents attributing a row to — and leaking the name of — a foreign user).
 * Callers should only validate a user id that is NEW/changed, so a former member on an old
 * row can still be re-saved.
 */
export async function assertMemberInOrg(ctx: MutationCtx, orgId: string, userId: string): Promise<void> {
  const mem = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  if (!mem) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Referenced user is not a member of your organization." });
  }
}
