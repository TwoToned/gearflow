import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Server-side read helpers for MaintenanceRecord (Phase A read-rewiring).
 *
 * `maintenanceRecord` is dual-written (Prisma anchor + Convex reactive doc — see
 * src/lib/maintenance-mirror.ts). Reads that only need the Convex copy go through
 * here. No Prisma fallback on a Convex miss. See FEATUREDOCS/54.
 */

/**
 * Distinct-tag aggregation feed: an org's maintenance records normalised to the
 * `{ tags }` shape `getOrgTags` consumes. `tags` is Prisma-defaulted to `[]`, so a
 * Convex doc with the field absent coerces to an empty array.
 */
export async function getMaintenanceTagsByOrg(
  organizationId: string,
): Promise<{ tags: string[] }[]> {
  const client = await getConvexClient();
  const docs = await client.query(api.maintenanceRecords.list, { orgId: organizationId });
  return docs.map((d) => ({ tags: d.tags ?? [] }));
}
