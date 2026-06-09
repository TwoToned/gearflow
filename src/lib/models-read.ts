import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the Models domain (Phase 3 cutover).
 *
 * Models are dual-written like Suppliers/Locations: every create/update/delete
 * writes BOTH the Prisma `model` row (the durable FK anchor — `asset` and
 * `bulk_asset` carry a **required + Restrict** FK; `model_media`,
 * `model_check_item`, `supplier_model_rate`, `model_bulk_accessory` carry a
 * **required + Cascade** FK; `project_line_item`, `supplier_order_item`,
 * `group_template_item`, `sub_hire_item` carry nullable FKs) AND the Convex
 * `models` doc (the reactive read source the browser subscribes to). Reads that
 * want reactivity — the model list, the model dropdowns, the edit form — go
 * through Convex via this helper / the `use-models` hooks. Cross-domain
 * `model.*` joins (~200 sites across assets / line-items / availability / the
 * PDF pipeline) stay on the always-fresh Prisma mirror and migrate at
 * Prisma-decommission. See FEATUREDOCS/54.
 */
export type ConvexModel = Doc<"models">;

export async function getModelById(id: string): Promise<ConvexModel | null> {
  return await (await getConvexClient()).query(api.models.getById, { id });
}

export async function getModelsByOrg(orgId: string): Promise<ConvexModel[]> {
  return await (await getConvexClient()).query(api.models.list, { orgId });
}

/** All of an org's models keyed by cuid `id`, for attaching to joined rows. */
export async function getModelMap(orgId: string): Promise<Map<string, ConvexModel>> {
  const all = await getModelsByOrg(orgId);
  return new Map(all.map((m) => [m.id, m]));
}

/**
 * Attach a `model` field to rows that carry a `modelId`, replacing a Prisma
 * `include: { model }`. One Convex round-trip per call (the org model map).
 */
export async function attachModel<T extends { modelId: string | null }>(
  orgId: string,
  rows: T[],
): Promise<Array<T & { model: ConvexModel | null }>> {
  if (rows.length === 0) return [];
  const map = await getModelMap(orgId);
  return rows.map((r) => ({
    ...r,
    model: r.modelId ? map.get(r.modelId) ?? null : null,
  }));
}
