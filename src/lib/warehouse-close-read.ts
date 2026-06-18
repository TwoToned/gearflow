import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helper for the WarehouseClose domain (Phase C cutover).
 *
 * warehouseCloses now live in Convex (source of truth). The close-out summary's
 * "already closed" lookup — formerly `prisma.warehouseClose.findFirst` — reads
 * through here. The Convex doc carries `id` (preserved cuid), `closedById`, the
 * three counts, and a numeric `closedAt` (epoch ms); the closer's display name
 * is resolved separately from the kept Postgres `user` table. See FEATUREDOCS/54.
 */
export type ConvexWarehouseClose = Doc<"warehouseCloses">;

/** The (at most one) close-out for a project, or null if not yet closed. */
export async function getWarehouseCloseByProject(
  orgId: string,
  projectId: string,
): Promise<ConvexWarehouseClose | null> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.warehouseCloses.getByProject, {
      orgId,
      projectId,
    }),
  );
}
