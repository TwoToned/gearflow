import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Clients domain (Phase 3 cutover).
 *
 * Clients now live in Convex (source of truth). Anything that used to read
 * `prisma.client` — directly or via a `include: { client }` relational join —
 * reads through here instead. Since Convex has no joins, callers that have rows
 * carrying a `clientId` fetch the org's client map once and attach in JS.
 *
 * The Convex client doc carries the same business fields as the old Prisma row
 * (name, type, isActive, contact*, billing/shipping, tags, notes) plus `id`
 * (the preserved cuid) and numeric `createdAt`/`updatedAt`; consumers read the
 * same field names as before. See FEATUREDOCS/54.
 */
export type ConvexClient = Doc<"clients">;

export async function getClientById(id: string): Promise<ConvexClient | null> {
  return await getConvexClient().query(api.clients.getById, { id });
}

export async function getClientsByOrg(orgId: string): Promise<ConvexClient[]> {
  return await getConvexClient().query(api.clients.list, { orgId });
}

/** All of an org's clients keyed by cuid `id`, for attaching to joined rows. */
export async function getClientMap(orgId: string): Promise<Map<string, ConvexClient>> {
  const all = await getClientsByOrg(orgId);
  return new Map(all.map((c) => [c.id, c]));
}

/**
 * Attach a `client` field to rows that carry a `clientId`, replacing a Prisma
 * `include: { client }`. One Convex round-trip per call (the org client map).
 */
export async function attachClient<T extends { clientId: string | null }>(
  orgId: string,
  rows: T[],
): Promise<Array<T & { client: ConvexClient | null }>> {
  if (rows.length === 0) return [];
  const map = await getClientMap(orgId);
  return rows.map((r) => ({
    ...r,
    client: r.clientId ? map.get(r.clientId) ?? null : null,
  }));
}
