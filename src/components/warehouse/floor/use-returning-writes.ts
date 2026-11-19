"use client";

import { useCallback, useMemo } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useReturnsWrites } from "@/hooks/use-returns";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { showError } from "@/lib/show-error";
import type { ReturnCondition, ReturningGroup, ReturningLine } from "@/lib/returning";
import type { ReturningUnit } from "@/lib/row-actions/returning-line";

/**
 * Returning mode's table writes. Each goes through an ANNOUNCED write
 * (`useWarehouseWrites` / `useReturnsWrites`), so every toast carries the Undo
 * its hook defines and nothing here derives a second reverse. A selection
 * across jobs is one write per job (each job's return is its own write, with
 * its own Undo).
 */
export function useReturningWrites(orgId: string | undefined, groups: readonly ReturningGroup[]) {
  const warehouse = useWarehouseWrites();
  const returns = useReturnsWrites();
  const convex = useConvex();

  const projectOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const l of g.lines) m.set(l.lineItemId, g.projectId);
    return m;
  }, [groups]);

  const returnLines = useCallback(
    async (lines: ReturningLine[], condition: ReturnCondition) => {
      const byJob = new Map<string, ReturningLine[]>();
      for (const l of lines) {
        const p = projectOf.get(l.lineItemId);
        if (p) byJob.set(p, [...(byJob.get(p) ?? []), l]);
      }
      for (const [projectId, jobLines] of byJob) {
        const kits = jobLines.filter((l) => l.kind === "kit" && l.kitId);
        const rest = jobLines.filter((l) => !(l.kind === "kit" && l.kitId));
        try {
          if (kits.length > 0) {
            await warehouse.checkInKitsBatch(projectId, kits.map((k) => ({ kitId: k.kitId!, returnCondition: condition })));
          }
          if (rest.length > 0) {
            await warehouse.checkInItems(projectId, rest.map((l) => ({ lineItemId: l.lineItemId, returnCondition: condition, quantity: l.out })));
          }
        } catch (e) {
          showError(e, { fallbackTitle: "Couldn't return that" });
        }
      }
    },
    [projectOf, warehouse],
  );

  const returnUnit = useCallback(
    async (line: ReturningLine, unit: ReturningUnit, condition: ReturnCondition) => {
      const projectId = projectOf.get(line.lineItemId);
      if (!projectId || !unit.assetId) return;
      try {
        await warehouse.checkInItems(projectId, [{ lineItemId: line.lineItemId, assetId: unit.assetId, returnCondition: condition }]);
      } catch (e) {
        showError(e, { fallbackTitle: "Couldn't return that unit" });
      }
    },
    [projectOf, warehouse],
  );

  const correct = useCallback(
    async (line: ReturningLine, unit: ReturningUnit, condition: ReturnCondition) => {
      try {
        await returns.correctCondition(
          { lineItemId: line.lineItemId, assetId: unit.assetId ?? undefined, unitId: unit.unitId, returnCondition: condition },
          (unit.returnCondition ?? "GOOD") as ReturnCondition,
        );
      } catch (e) {
        showError(e, { fallbackTitle: "Couldn't change the outcome" });
      }
    },
    [returns],
  );

  const raiseRepairFor = useCallback(
    async (line: ReturningLine, assets: Array<{ assetId: string; assetTag: string | null }>) => {
      const projectId = projectOf.get(line.lineItemId);
      if (!projectId || assets.length === 0) return;
      try {
        await returns.raiseRepair({ projectId, label: line.modelName ?? line.description, assets });
      } catch (e) {
        showError(e, { fallbackTitle: "Couldn't raise the repair" });
      }
    },
    [projectOf, returns],
  );

  /** One repair per line, linking that line's damaged returned units. */
  const raiseRepair = useCallback(
    async (lines: ReturningLine[]) => {
      if (!orgId) return;
      for (const line of lines) {
        const res = await convex.query(api.warehouseFloor.lineUnits, { orgId, lineItemId: line.lineItemId });
        const damaged = (res?.units ?? []).filter((u) => u.assetId && u.returnCondition === "DAMAGED");
        await raiseRepairFor(line, damaged.map((u) => ({ assetId: u.assetId!, assetTag: u.assetTag })));
      }
    },
    [convex, orgId, raiseRepairFor],
  );

  const raiseUnitRepair = useCallback(
    (line: ReturningLine, unit: ReturningUnit) =>
      unit.assetId ? raiseRepairFor(line, [{ assetId: unit.assetId, assetTag: unit.assetTag }]) : undefined,
    [raiseRepairFor],
  );

  return { returnLines, returnUnit, correct, raiseRepair, raiseUnitRepair };
}
