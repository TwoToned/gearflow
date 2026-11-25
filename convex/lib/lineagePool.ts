import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { listProjectVersions } from "./projectVersionState";
import { adjustModelSaleStock, type SaleActor } from "./saleStock";
import { lineagePoolDelta, type PoolRow } from "./saleStockFacts";

/**
 * The new-stock pool is accounted PER LINEAGE (review ruling, UX Phase 14). A lineage is one logical sale line
 * across versions: a copy into another version is the SAME add, so it takes nothing more from the pool, and
 * deleting one copy while another still holds the stock restores nothing. Every write that can change what a
 * lineage takes (add, patch of quantity or model, delete of a row or of a whole version) computes the change in
 * the lineage's pool-taking maximum before and after (`lineagePoolDelta`, pure, in saleStockFacts) and applies
 * exactly that, so `pool + reserved = physical stock` holds after every step. Cancel stays the logged follow-up:
 * it restores nothing, and the line keeps counting as reserved, consistently.
 */

/** Sale rows a project has in one lineage (org re-checked), optionally leaving some row ids out. */
export async function loadLineageRows(ctx: MutationCtx, orgId: string, projectId: string, lineageKey: string, leaveOut: ReadonlySet<string> = new Set()): Promise<Doc<"projectLineItems">[]> {
  // A lineage has at most one row per version: one indexed probe per version of the project.
  const out: Doc<"projectLineItems">[] = [];
  for (const version of await listProjectVersions(ctx, orgId, projectId)) {
    const rows = await ctx.db
      .query("projectLineItems")
      .withIndex("by_versionId_lineageId", (q) => q.eq("versionId", version.id).eq("lineageId", lineageKey))
      .take(20);
    out.push(...rows.filter((r) => r.organizationId === orgId && r.projectId === projectId && r.type === "SALE" && !leaveOut.has(r.id)));
  }
  return out;
}

const asPoolRow = (r: Pick<Doc<"projectLineItems">, "type" | "saleMode" | "modelId" | "quantity" | "status">): PoolRow => ({
  type: r.type, saleMode: r.saleMode, modelId: r.modelId, quantity: r.quantity, status: r.status,
});

/** Apply the pool change a lineage's rows going from `before` to `after` imply (one adjustment per model). */
export async function applyLineagePoolChange(
  ctx: MutationCtx,
  a: { orgId: string; projectId: string; lineItemId: string; actor: SaleActor; now: number; before: PoolRow[]; after: PoolRow[] },
): Promise<void> {
  for (const [modelId, delta] of lineagePoolDelta(a.before, a.after)) {
    await adjustModelSaleStock(ctx, { modelId, orgId: a.orgId, delta, projectId: a.projectId, lineItemId: a.lineItemId, actor: a.actor, now: a.now });
  }
}

/** A row was just inserted: the lineage goes from its other rows to those plus this one. */
export async function applyLineageAdd(ctx: MutationCtx, a: { orgId: string; line: Doc<"projectLineItems">; actor: SaleActor; now: number }): Promise<void> {
  const others = (await loadLineageRows(ctx, a.orgId, a.line.projectId, a.line.lineageId ?? a.line.id, new Set([a.line.id]))).map(asPoolRow);
  await applyLineagePoolChange(ctx, { orgId: a.orgId, projectId: a.line.projectId, lineItemId: a.line.id, actor: a.actor, now: a.now, before: others, after: [...others, asPoolRow(a.line)] });
}

/** A row was just deleted (`line` is its last state): the lineage goes from its remaining rows plus it to just the remaining rows. */
export async function applyLineageDelete(
  ctx: MutationCtx,
  a: { orgId: string; line: Pick<Doc<"projectLineItems">, "id" | "projectId" | "lineageId" | "type" | "saleMode" | "modelId" | "quantity" | "status">; actor: SaleActor; now: number },
): Promise<void> {
  const rest = (await loadLineageRows(ctx, a.orgId, a.line.projectId, a.line.lineageId ?? a.line.id, new Set([a.line.id]))).map(asPoolRow);
  await applyLineagePoolChange(ctx, { orgId: a.orgId, projectId: a.line.projectId, lineItemId: a.line.id, actor: a.actor, now: a.now, before: [...rest, asPoolRow(a.line)], after: rest });
}

/** A row is about to change quantity or model: the lineage goes from its current rows to the same rows with this one changed. */
export async function applyLineagePatch(
  ctx: MutationCtx,
  a: { orgId: string; doc: Doc<"projectLineItems">; modelId: string | null; quantity: number; actor: SaleActor; now: number },
): Promise<void> {
  const others = (await loadLineageRows(ctx, a.orgId, a.doc.projectId, a.doc.lineageId ?? a.doc.id, new Set([a.doc.id]))).map(asPoolRow);
  const patched: PoolRow = { ...asPoolRow(a.doc), modelId: a.modelId ?? undefined, quantity: a.quantity };
  await applyLineagePoolChange(ctx, { orgId: a.orgId, projectId: a.doc.projectId, lineItemId: a.doc.id, actor: a.actor, now: a.now, before: [...others, asPoolRow(a.doc)], after: [...others, patched] });
}

/** A whole version's rows are about to be deleted: apply the change for every lineage they touch (call BEFORE deleting). */
export async function applyVersionDeletePool(ctx: MutationCtx, a: { orgId: string; projectId: string; rows: Doc<"projectLineItems">[]; actor: SaleActor; now: number }): Promise<void> {
  const gone = new Set(a.rows.map((r) => r.id));
  const keys = new Set(a.rows.filter((r) => r.type === "SALE").map((r) => r.lineageId ?? r.id));
  for (const key of keys) {
    const all = await loadLineageRows(ctx, a.orgId, a.projectId, key);
    const rest = all.filter((r) => !gone.has(r.id)).map(asPoolRow);
    const lineItemId = all.find((r) => gone.has(r.id))?.id ?? key;
    await applyLineagePoolChange(ctx, { orgId: a.orgId, projectId: a.projectId, lineItemId, actor: a.actor, now: a.now, before: all.map(asPoolRow), after: rest });
  }
}
