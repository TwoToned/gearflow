import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Client-scoping helpers shared by the client timeline read model
 * (`convex/clientTimeline.ts`), its writers (`convex/clientTimelineWrites.ts`),
 * the pipeline view (`convex/pipeline.ts`) and the `quote:nonext` Triage
 * signal (`convex/dashboardLists.ts`) — Phase 3 (#1245).
 *
 * ⚠️ R-8.4.3: `clients.by_cuid` and `projects.by_clientId` are GLOBAL Convex
 * indexes. Every loader here re-checks `organizationId` — use these rather
 * than querying either table directly.
 */

/** Load a client by cuid and assert it belongs to `orgId`. Throws `NOT_FOUND`
 *  for both "missing" and "another org's", so a cross-tenant probe can't
 *  distinguish the two (mirrors `quoteState.ts`'s `requireQuoteInOrg`). */
export async function requireClientInOrg(
  ctx: QueryCtx | MutationCtx,
  clientId: string,
  orgId: string,
): Promise<Doc<"clients">> {
  const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
  if (!client || client.organizationId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Client not found." });
  }
  return client;
}

// Bounds the client → project fan-out every timeline/rotting read does. A
// client with more history than this reads its timeline/rotting signal off
// its most-recently-created projects only — same "cap server-side with a
// count" posture as `dashboardLists.ts`'s MANAGED_PROJECTS_LIMIT (design §10.7).
export const CLIENT_PROJECTS_LIMIT = 60;

/** This client's projects, org-checked (`by_clientId` is global), newest
 *  first, bounded to `CLIENT_PROJECTS_LIMIT`. */
export async function listClientProjects(
  ctx: QueryCtx | MutationCtx,
  clientId: string,
  orgId: string,
): Promise<Doc<"projects">[]> {
  const rows = await ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).collect();
  return rows
    .filter((p) => p.organizationId === orgId && p.isTemplate !== true)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, CLIENT_PROJECTS_LIMIT);
}
