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
 * Sum of `lineTotal` over a project's non-CANCELLED, CHARGED services — a service
 * bills iff it has an actual charge (`lineTotal` is null/0 until a unitPrice is
 * typed or a crew charge rate auto-prices it). Org-scoped Convex `list` is
 * filtered to the project here; null/zero `lineTotal` contributes 0, which is
 * what makes an unpriced (internal-only) service exclude itself with no separate
 * flag to check. Mirrors `convex/lib/recalc.ts`'s `serviceRevenue` — kept in sync
 * there (R-3.1).
 */
export function sumProjectServiceRevenue(
  services: ConvexProjectService[],
  projectId: string,
): number {
  let total = 0;
  for (const s of services) {
    if (s.projectId !== projectId) continue;
    if (s.status === "CANCELLED") continue;
    total += s.lineTotal ?? 0;
  }
  return total;
}

/**
 * Same scope as `sumProjectServiceRevenue`, narrowed to LABOUR-type services
 * (WS10 #949 — labour charge rates & margin). Non-zero once a crew role (or
 * per-service override) has a configured charge rate, since that's what makes a
 * LABOUR service's `lineTotal` auto-price instead of staying null. Mirrors
 * `convex/projectCosts.ts`'s `operationalCosts` query — kept in sync there.
 */
export function sumProjectLabourServiceRevenue(
  services: ConvexProjectService[],
  projectId: string,
): number {
  let total = 0;
  for (const s of services) {
    if (s.projectId !== projectId) continue;
    if (s.status === "CANCELLED") continue;
    if (s.type !== "LABOUR") continue;
    total += s.lineTotal ?? 0;
  }
  return total;
}
