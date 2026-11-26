import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { resolveActor } from "./auth";
import { assertWritesEnabled } from "./writeGuard";
import { enforceBrowserWriteLimit } from "./rateLimiter";

/**
 * The shared front door of the browser-direct maintenance writes that are not the record's own create / update
 * (parts, Complete, Reopen): writes enabled, the browser rate limit, the permission, then the verified actor, in the
 * one order the security bar names. One copy, not one per module (R-3.1).
 *
 * The permission check is PASSED IN (`() => requireOrgPermission(ctx, orgId, "maintenance", "update")`, written in
 * the handler): the API registry generator finds an operation's scope by reading that literal call out of the
 * handler's own source, so hiding it in here would silently make every caller's operation unreachable for agents.
 */
export async function maintenanceWritePrelude(
  ctx: MutationCtx,
  actor: { userId: string; userName: string },
  permit: () => Promise<unknown>,
) {
  await assertWritesEnabled(ctx, "maintenance");
  await enforceBrowserWriteLimit(ctx);
  await permit();
  return resolveActor(ctx, actor);
}

/** A maintenance record by cuid, org-checked (`by_cuid` is global). */
export async function loadMaintenanceRecord(ctx: MutationCtx, orgId: string, recordId: string): Promise<Doc<"maintenanceRecords">> {
  const rec = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", recordId)).first();
  if (!rec || rec.organizationId !== orgId) throw new ConvexError("Maintenance record not found");
  return rec;
}
