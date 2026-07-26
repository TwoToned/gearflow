import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";

/**
 * Org-wide returns station board (issue #944 WS5) — "everything out", no project
 * pre-selection. Range-reads CHECKED_OUT `projectLineItems` ORG-WIDE via the new
 * `by_organizationId_status` composite index (convex/schema.ts) and groups by
 * project, ordered overdue-first (mirrors `getProjectUrgency` in
 * src/app/(app)/warehouse/page.tsx — the existing "The floor" landing page's
 * urgency classifier, ported server-side here so the board can sort before it
 * ever reaches the client). requireOrgPermission("warehouse","read").
 *
 * ── Bounded read (POLICY.md R-9.8) ──
 * `.take(MAX_ROWS)` caps the range-read — an org-wide CHECKED_OUT scan is
 * conceptually unbounded as an org's active fleet grows. This is NOT a silent
 * unbounded collect: it's a registered, expiring exception — see
 * docs/exceptions.md (R-9.8, "returns-board-orgwide-checkedout"). `truncated` in
 * the response tells the client when the cap was hit so it can surface that
 * instead of silently showing a partial board.
 *
 * ── One-shot + session-local optimistic list, not a live subscription ──
 * Per the WS5 spec: the /warehouse/* LCP budget is already over per
 * docs/exceptions.md (R-8.9.3) — adding a whole-org reactive subscription here
 * would make that worse, not better. The client fetches this once, keeps its own
 * session-local list, and calls `bundle` again (a refresh button + a refetch
 * after every mutation) rather than subscribing.
 *
 * ── What counts as a top-level row ──
 * Standalone / sub-hire / custom / kit-parent lines (`isKitChild` false).
 * ACCESSORY children cascade with their parent (attached, not independent rows —
 * mirrors the PDF pipeline's parent/child rule, CLAUDE.md's PDF section). Kit
 * MEMBER lines roll up under the kit parent — a kit returns as a whole via
 * `checkInKit`, so its members are never independently listed here. Sub-hire and
 * custom lines are display-only (unscannable — no asset/bulk tag exists to scan).
 * Partially-returned lines are included by construction: `returnLineUnits` only
 * flips a line's own `status` to RETURNED once every unit is back, so a
 * partially-returned line is still CHECKED_OUT and lands in this range-read.
 */

const MAX_ROWS = 2000;

type UrgencyGroup = "overdue" | "today" | "out" | "returned" | "upcoming";
const URGENCY_ORDER: readonly UrgencyGroup[] = ["overdue", "today", "out", "returned", "upcoming"];

type ProjectLike = { status?: string; rentalStartDate?: number; rentalEndDate?: number };

/** Port of getProjectUrgency (src/app/(app)/warehouse/page.tsx) — kept in lockstep
 *  deliberately rather than imported (that file is a client component). */
function projectUrgency(p: ProjectLike): UrgencyGroup {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayAfterTomorrow = today + 2 * 24 * 60 * 60 * 1000;
  const dayOf = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  if (p.status === "RETURNED") return "returned";

  const isOut = p.status === "CHECKED_OUT" || p.status === "ON_SITE";
  if (isOut) {
    if (p.rentalEndDate != null && dayOf(p.rentalEndDate) < today) return "overdue";
    return "out";
  }

  if (p.rentalStartDate == null) return "upcoming";
  return dayOf(p.rentalStartDate) < dayAfterTomorrow ? "today" : "upcoming";
}

type LineKind = "serialized" | "bulk" | "kit" | "subhire" | "custom" | "generic";

function classifyLine(line: { kitId?: string; subHireId?: string; isCustomItem?: boolean; bulkAssetId?: string; assetId?: string }): LineKind {
  if (line.kitId) return "kit";
  if (line.subHireId) return "subhire";
  if (line.isCustomItem) return "custom";
  if (line.bulkAssetId) return "bulk";
  if (line.assetId) return "serialized";
  return "generic";
}

async function loadByIds<T extends { id: string }>(
  ctx: QueryCtx,
  table: "projects" | "models" | "kits" | "assets",
  ids: string[],
  orgId: string,
): Promise<Map<string, T>> {
  const rows = await Promise.all(
    ids.map((id) => ctx.db.query(table).withIndex("by_cuid", (q) => q.eq("id", id)).first()),
  );
  const map = new Map<string, T>();
  for (const r of rows) {
    if (r && (r as unknown as { organizationId: string }).organizationId === orgId) {
      map.set(r.id, r as unknown as T);
    }
  }
  return map;
}

export const bundle = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgPermission(ctx, orgId, "warehouse", "read");

    // r9.8-ok: bounded by MAX_ROWS — see docs/exceptions.md R-9.8
    // (returns-board-orgwide-checkedout).
    const rows = await ctx.db
      .query("projectLineItems")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "CHECKED_OUT"))
      .take(MAX_ROWS);

    const topLevel = rows.filter((r) => !r.isKitChild);
    const accessoryChildren = rows.filter((r) => r.isKitChild && r.childKind === "ACCESSORY");
    const accessoriesByParent = new Map<string, typeof accessoryChildren>();
    for (const c of accessoryChildren) {
      if (!c.parentLineItemId) continue;
      const arr = accessoriesByParent.get(c.parentLineItemId) ?? [];
      arr.push(c);
      accessoriesByParent.set(c.parentLineItemId, arr);
    }

    const projectIds = [...new Set(topLevel.map((r) => r.projectId))];
    const modelIds = [...new Set([...topLevel, ...accessoryChildren].map((r) => r.modelId).filter((m): m is string => !!m))];
    const kitIds = [...new Set(topLevel.map((r) => r.kitId).filter((k): k is string => !!k))];

    type ProjectDoc = { id: string; name: string; projectNumber: string; status?: string; rentalStartDate?: number; rentalEndDate?: number; isTemplate?: boolean };
    type ModelDoc = { id: string; name: string };
    type KitDoc = { id: string; assetTag: string; name: string };

    const [projectById, modelById, kitById] = await Promise.all([
      loadByIds<ProjectDoc>(ctx, "projects", projectIds, orgId),
      loadByIds<ModelDoc>(ctx, "models", modelIds, orgId),
      loadByIds<KitDoc>(ctx, "kits", kitIds, orgId),
    ]);

    type LineSummary = {
      lineItemId: string;
      description: string;
      modelName: string | null;
      kind: LineKind;
      quantity: number;
      checkedOutQuantity: number;
      returnedQuantity: number;
      outstanding: number;
      scannable: boolean;
      kitId: string | null;
      kitAssetTag: string | null;
      accessories: Array<{ lineItemId: string; description: string; outstanding: number }>;
    };

    const projectGroups = new Map<string, { project: ProjectDoc; lines: LineSummary[] }>();

    for (const line of topLevel) {
      const project = projectById.get(line.projectId);
      if (!project || project.isTemplate) continue; // template / not-in-org (already org-scoped by index, defensive)

      const checkedOutQuantity = line.checkedOutQuantity ?? line.quantity ?? 0;
      const returnedQuantity = line.returnedQuantity ?? 0;
      const outstanding = Math.max(0, checkedOutQuantity - returnedQuantity);
      const kids = accessoriesByParent.get(line.id) ?? [];
      if (outstanding <= 0 && kids.length === 0) continue;

      const kind = classifyLine(line);
      const model = line.modelId ? modelById.get(line.modelId) ?? null : null;
      const kit = line.kitId ? kitById.get(line.kitId) ?? null : null;

      const accessories = kids.map((c) => ({
        lineItemId: c.id,
        description: c.description ?? (c.modelId ? modelById.get(c.modelId)?.name : undefined) ?? "Accessory",
        outstanding: Math.max(0, (c.checkedOutQuantity ?? c.quantity ?? 0) - (c.returnedQuantity ?? 0)),
      }));

      const summary: LineSummary = {
        lineItemId: line.id,
        description: line.description ?? model?.name ?? "Item",
        modelName: model?.name ?? null,
        kind,
        quantity: line.quantity ?? 0,
        checkedOutQuantity,
        returnedQuantity,
        outstanding,
        scannable: kind !== "subhire" && kind !== "custom",
        kitId: line.kitId ?? null,
        kitAssetTag: kit?.assetTag ?? null,
        accessories,
      };

      const g = projectGroups.get(line.projectId) ?? { project, lines: [] };
      g.lines.push(summary);
      projectGroups.set(line.projectId, g);
    }

    const groups = [...projectGroups.values()].map((g) => ({
      projectId: g.project.id,
      projectName: g.project.name,
      projectNumber: g.project.projectNumber,
      status: g.project.status ?? null,
      rentalEndDate: g.project.rentalEndDate ?? null,
      urgency: projectUrgency(g.project),
      lines: g.lines.sort((a, b) => a.description.localeCompare(b.description)),
    }));

    groups.sort((a, b) => {
      const ai = URGENCY_ORDER.indexOf(a.urgency);
      const bi = URGENCY_ORDER.indexOf(b.urgency);
      if (ai !== bi) return ai - bi;
      return (a.rentalEndDate ?? Infinity) - (b.rentalEndDate ?? Infinity);
    });

    return { projects: groups, truncated: rows.length >= MAX_ROWS };
  },
});

/** Expand a single line's CHECKED_OUT units on demand (unit chips) — the board
 *  query itself deliberately stays line-level to keep the initial payload small. */
export const unitsForLine = query({
  args: { orgId: v.string(), lineItemId: v.string() },
  handler: async (ctx, { orgId, lineItemId }) => {
    await requireOrgPermission(ctx, orgId, "warehouse", "read");

    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
    if (!line || line.organizationId !== orgId) return [];

    const units = (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineItemId)).collect())
      .filter((u) => u.status === "CHECKED_OUT");

    const assetIds = [...new Set(units.map((u) => u.assetId).filter((a): a is string => !!a))];
    const assetById = await loadByIds<{ id: string; assetTag: string }>(ctx, "assets", assetIds, orgId);

    return units.map((u) => ({
      unitId: u.id,
      assetId: u.assetId ?? null,
      assetTag: u.assetId ? assetById.get(u.assetId)?.assetTag ?? null : null,
      quantity: u.quantity ?? 1,
      returnedQuantity: u.returnedQuantity ?? 0,
      outstanding: Math.max(0, (u.quantity ?? 0) - (u.returnedQuantity ?? 0)),
    }));
  },
});
