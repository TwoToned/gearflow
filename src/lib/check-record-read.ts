import { getConvexClient } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { getProjectsByOrg } from "@/lib/projects-read";
import { getAssetsByOrg } from "@/lib/assets-read";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Server-side read helpers for the check-record domain (Phase A read-rewiring of
 * the Convex domain-only decommission). `checkRecord`, `modelCheckItem`, and
 * `projectLineItem` are dual-written; these helpers read the Convex copies and
 * shape them back into the Prisma-row form the asset check-history + model
 * failure-analytics UIs expect (epoch-ms → Date, absent optionals → null).
 *
 * Joins:
 * - checkItem label/type for history come from the snapshot fields ON the check
 *   record row (mirror-miss-proof; the join is never needed).
 * - performedBy.name is a Better Auth User — resolved via Prisma (auth stays
 *   Prisma forever).
 * - lineItem → project is resolved by mapping lineItemId → projectId (Convex
 *   projectLineItems.listByIds) then projectId → {id,name,projectNumber}
 *   (projects-read).
 * - failure-analytics checkItem label/type come from checkItems.list (the
 *   modelCheckItem row carries no label/type).
 */

type RawCheckRecord = Doc<"checkRecords">;
type RawModelCheckItem = Doc<"modelCheckItems">;
type RawCheckItem = Doc<"checkItems">;
type RawLineItem = Doc<"projectLineItems">;

const toDate = (n: number | undefined): Date | null => (typeof n === "number" ? new Date(n) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

// ─── getCheckHistory ─────────────────────────────────────────────────────────

export interface CheckHistoryProject {
  id: string;
  name: string;
  projectNumber: string;
}

export interface CheckHistoryRow {
  id: string;
  result: string;
  context: string;
  value: string | null;
  notes: string | null;
  photos: string[];
  performedAt: Date;
  assetId: string | null;
  checkItem: { label: string; type: string | null; category: null };
  performedBy: { name: string } | null;
  lineItem: { project: CheckHistoryProject | null } | null;
}

/**
 * Resolve a set of Better Auth user ids → name map. Auth-User joins stay Prisma
 * forever (NOT a Convex-decommission violation).
 */
async function getUserNameMap(userIds: string[]): Promise<Map<string, string | null>> {
  const distinct = [...new Set(userIds)];
  if (distinct.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: distinct } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * Map a raw Convex check-record row + the resolved joins into the Prisma-shaped
 * row the asset check-history UI consumes. `performedAt` must never be null (the
 * UI groups sessions by date) — fall back to the Convex creation time.
 */
export function mapCheckHistoryRow(
  d: RawCheckRecord,
  userNames: Map<string, string | null>,
  projectByLineItem: Map<string, CheckHistoryProject | null>,
): CheckHistoryRow {
  const performerName = d.performedById ? userNames.get(d.performedById) ?? null : null;
  return {
    id: req(d.id),
    result: req(d.result),
    context: req(d.context),
    value: orNull(d.value),
    notes: orNull(d.notes),
    photos: d.photos ?? [],
    performedAt: toDate(d.performedAt) ?? new Date(d._creationTime),
    assetId: orNull(d.assetId),
    checkItem: {
      label: req(d.checkItemLabelSnapshot),
      type: orNull(d.checkItemTypeSnapshot),
      category: null,
    },
    performedBy: performerName ? { name: performerName } : null,
    lineItem: d.lineItemId
      ? { project: projectByLineItem.get(d.lineItemId) ?? null }
      : null,
  };
}

/** Pure: optional context filter + performedAt-desc sort. Unit-tested. */
export function filterAndSortCheckHistory(
  rows: CheckHistoryRow[],
  context?: string,
): CheckHistoryRow[] {
  const filtered = context ? rows.filter((r) => r.context === context) : rows;
  return [...filtered].sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());
}

export async function getCheckHistoryRows(
  orgId: string,
  assetId: string,
  context?: string,
): Promise<CheckHistoryRow[]> {
  const client = await getConvexClient();
  const raw = (await client.query(api.checkRecords.listByOrgAndAsset, {
    orgId,
    assetId,
  })) as RawCheckRecord[];

  // Resolve performedBy names (Prisma) — batched over distinct performer ids.
  const userNames = await getUserNameMap(raw.map((r) => r.performedById).filter(Boolean));

  // Resolve lineItemId → projectId → project. checkRecord has lineItemId only.
  const lineItemIds = [...new Set(raw.map((r) => r.lineItemId).filter((x): x is string => !!x))];
  const projectByLineItem = new Map<string, CheckHistoryProject | null>();
  if (lineItemIds.length > 0) {
    const [lineItems, projects] = await Promise.all([
      client.query(api.projectLineItems.listByIds, { ids: lineItemIds, orgId }) as Promise<RawLineItem[]>,
      getProjectsByOrg(orgId),
    ]);
    const projMap = new Map<string, CheckHistoryProject>(
      projects.map((p) => [
        p.id,
        { id: p.id, name: p.name, projectNumber: p.projectNumber },
      ]),
    );
    for (const li of lineItems) {
      projectByLineItem.set(li.id, li.projectId ? projMap.get(li.projectId) ?? null : null);
    }
  }

  const mapped = raw.map((r) => mapCheckHistoryRow(r, userNames, projectByLineItem));
  return filterAndSortCheckHistory(mapped, context);
}

// ─── getModelFailureAnalytics ────────────────────────────────────────────────

export interface ModelFailureAnalyticsRow {
  checkItemId: string;
  label: string;
  type: string | null;
  totalChecks: number;
  failCount: number;
  failRate: number;
}

/**
 * Pure: aggregate PASS/FAIL counts per checkItemId over the supplied check
 * records, scoped to the asset ids of the model, in modelCheckItem sortOrder.
 * Unit-tested.
 */
export function aggregateModelFailureAnalytics(
  modelCheckItems: Array<{ checkItemId: string; sortOrder: number | null }>,
  records: Array<{ checkItemId: string; assetId: string | null; result: string }>,
  assetIds: Set<string>,
  labelByCheckItem: Map<string, { label: string; type: string | null }>,
): ModelFailureAnalyticsRow[] {
  const ordered = [...modelCheckItems].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  return ordered.map((mci) => {
    let totalChecks = 0;
    let failCount = 0;
    for (const r of records) {
      if (r.checkItemId !== mci.checkItemId) continue;
      if (!r.assetId || !assetIds.has(r.assetId)) continue;
      if (r.result === "PASS" || r.result === "FAIL") totalChecks += 1;
      if (r.result === "FAIL") failCount += 1;
    }
    const ci = labelByCheckItem.get(mci.checkItemId);
    return {
      checkItemId: mci.checkItemId,
      label: ci?.label ?? "",
      type: ci?.type ?? null,
      totalChecks,
      failCount,
      failRate: totalChecks > 0 ? failCount / totalChecks : 0,
    };
  });
}

export async function getModelFailureAnalyticsRows(
  orgId: string,
  modelId: string,
): Promise<ModelFailureAnalyticsRow[]> {
  const client = await getConvexClient();

  const modelCheckItems = (await client.query(api.modelCheckItems.listByModel, {
    orgId,
    modelId,
  })) as RawModelCheckItem[];

  const orgAssets = await getAssetsByOrg(orgId);
  const assetIds = new Set(orgAssets.filter((a) => a.modelId === modelId).map((a) => a.id));

  if (assetIds.size === 0 || modelCheckItems.length === 0) return [];

  const [checkItems, records] = await Promise.all([
    client.query(api.checkItems.list, { orgId }) as Promise<RawCheckItem[]>,
    client.query(api.checkRecords.list, { orgId }) as Promise<RawCheckRecord[]>,
  ]);

  const labelByCheckItem = new Map<string, { label: string; type: string | null }>(
    checkItems.map((ci) => [ci.id, { label: ci.label, type: orNull(ci.type) }]),
  );

  return aggregateModelFailureAnalytics(
    modelCheckItems.map((m) => ({ checkItemId: m.checkItemId, sortOrder: orNull(m.sortOrder) })),
    records.map((r) => ({ checkItemId: r.checkItemId, assetId: orNull(r.assetId), result: r.result })),
    assetIds,
    labelByCheckItem,
  );
}
