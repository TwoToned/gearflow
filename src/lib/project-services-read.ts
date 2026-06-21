import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Project Services domain (Phase A read-rewiring).
 *
 * `projectService` is dual-written (Prisma row + Convex `projectServices` doc — see
 * src/lib/project-subtable-mirror.ts). The operational-P&L revenue aggregate (sum of
 * billable `lineTotal`) goes through the pure helper below. `lineTotal` is stored as a
 * plain number in Convex (Prisma `Decimal` → number on mirror). See FEATUREDOCS/54.
 */
export type ConvexProjectService = Doc<"projectServices">;

export async function getProjectServicesByOrg(
  orgId: string,
): Promise<ConvexProjectService[]> {
  return await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.projectServices.list, { orgId }),
  );
}

/**
 * Sum of `lineTotal` over a project's non-CANCELLED, document-visible services.
 * Replicates Prisma `aggregate({ where: { projectId, status: { not: CANCELLED },
 * showOnDocuments: true }, _sum: { lineTotal } })`. Org-scoped Convex `list` is
 * filtered to the project here; null `lineTotal` contributes 0.
 *
 * NOTE on `showOnDocuments`: Prisma's `showOnDocuments: true` matches only rows
 * whose column is exactly `true`. The Convex field is optional, so a row with the
 * value absent reads `undefined` and is correctly excluded by the strict `=== true`.
 */
export function sumProjectServiceRevenue(
  services: ConvexProjectService[],
  projectId: string,
): number {
  let total = 0;
  for (const s of services) {
    if (s.projectId !== projectId) continue;
    if (s.status === "CANCELLED") continue;
    if (s.showOnDocuments !== true) continue;
    total += s.lineTotal ?? 0;
  }
  return total;
}
