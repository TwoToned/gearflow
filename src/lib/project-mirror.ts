import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `project` (incl. templates, `isTemplate: true`) — the most-referenced central
 * table — is DUAL-WRITTEN **infra-only**: no Phase 4. Projects are read through
 * deep cross-domain compositions (the equipment editor, dashboards, PDF pipeline,
 * availability) that stay on Prisma. The mirror keeps the Convex graph complete
 * for the eventual decommission. See FEATUREDOCS/54.
 *
 * Dual-write: 15 inbound FKs, most required+Cascade (line_item / media /
 * crew_assignment / service / warehouse_close / category / group / manager /
 * task) — a Convex-only cutover would FK-fail. clientId already lives in Convex.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent) — tolerable for a
 * consumer-less mirror; heals on a backfill run.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

const RELATION_KEYS = new Set([
  "client", "location", "lineItems", "categories", "groups", "media",
  "services", "managers", "assignments", "tasks", "subHires", "supplierOrders",
  "scanLogs", "warehouseCloses", "organization", "projectManager",
  "_count", "maintenanceRecords", "woocommerceOrderLogs",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(strip(row)) as any);
}
async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(strip(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}
async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

export const mirrorProjectCreate = (row: Record<string, unknown>) => create(api.projects.createIfMissing, row);
export const patchProjectInConvex = (id: string, row: Record<string, unknown>) => patch(api.projects.update, id, row);
export const removeProjectFromConvex = (id: string) => remove(api.projects.remove, id);

/** Re-read a project from Prisma (scalars only) and patch it into Convex. For
 *  multi-field updates where the caller doesn't hold the written row. */
export async function syncProjectToConvex(projectId: string | null | undefined) {
  if (!projectId) return;
  const row = await prisma.project.findUnique({ where: { id: projectId } });
  if (row) await patchProjectInConvex(row.id, row as unknown as Record<string, unknown>);
}
