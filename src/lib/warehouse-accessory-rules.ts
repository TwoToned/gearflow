/** Pure accessory-on-the-floor rules (spec §9.5; decisions D8, D9, D10). */
import type { LineItem } from "@/components/warehouse/warehouse-types";

/** D8: a bulk accessory (no per-unit tag) verifies on a COUNT at its bin barcode. */
export type CountVerdict = "none" | "partial" | "full";
export function verifyByCount(counted: number, needed: number): CountVerdict {
  if (counted <= 0 || needed <= 0) return "none";
  return counted >= needed ? "full" : "partial";
}

/**
 * D9: the reason prefilled when a DEFAULT accessory is left behind. It is the
 * office's own note on the parent's plan (`accessoryPlan.excludedReasons`),
 * editable and still logged. Empty when the office left none.
 */
export function prefillOverrideReason(parent: Pick<LineItem, "accessoryPlan">, bulkAssetId: string | null | undefined): string {
  if (!bulkAssetId) return "";
  return parent.accessoryPlan?.excludedReasons?.find((r) => r.bulkAssetId === bulkAssetId)?.reason.trim() ?? "";
}

/**
 * D10: "Remember for the next n" is scoped to the JOB (in memory, never
 * localStorage). A choice made on one job never applies to another.
 */
export type RememberedChoice = { decision: "pack" | "later" | "keep"; remaining: number };
export class JobRememberStore {
  private byJob = new Map<string, RememberedChoice>();
  remember(projectId: string, parentKey: string, decision: RememberedChoice["decision"], n: number) {
    if (n > 0) this.byJob.set(`${projectId}\0${parentKey}`, { decision, remaining: n });
  }
  /** Consumes one unit of the remembered choice, or returns null. */
  take(projectId: string, parentKey: string): RememberedChoice["decision"] | null {
    const k = `${projectId}\0${parentKey}`;
    const c = this.byJob.get(k);
    if (!c) return null;
    if (c.remaining <= 1) this.byJob.delete(k);
    else this.byJob.set(k, { ...c, remaining: c.remaining - 1 });
    return c.decision;
  }
}

/** The footer tally: `accessories: 30 packed · 11 to pick · 1 skipped`. */
export function accessoryTally(states: Array<"packed" | "pick" | "skipped">): string {
  const n = (s: string) => states.filter((x) => x === s).length;
  return `accessories: ${n("packed")} packed · ${n("pick")} to pick · ${n("skipped")} skipped`;
}
