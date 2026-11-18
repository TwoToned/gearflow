/**
 * What a tag scanned on the Returned stage resolves to (decided SERVER-side by `lookupDeprepScan`,
 * so the Returned dock is validated like every other stage and never against a client-held list).
 * Pure shapes and the plan from a result live here; the lookup itself is `src/server/warehouse-deprep-scan.ts`.
 */
export type DeprepScanResult =
  | { kind: "none" }
  | { kind: "refuse"; text: string }
  | { kind: "kit"; lineItemId: string; kitId: string; name: string }
  /** One serialised unit: de-prep exactly one. */
  | { kind: "unit"; lineItemId: string; assetId: string; name: string }
  /** An accessory unit scanned on its own tag. */
  | { kind: "accessory"; lineItemId: string; unitId: string; assetId: string; name: string }
  /** A bulk bin: the packer counts how many came back (D8). `remaining` caps the count. */
  | { kind: "bulk"; lineItemId: string; name: string; remaining: number };

export type DeprepPlan =
  | { kind: "keys"; keys: string[]; text: string }
  | { kind: "accessoryUnit"; unitId: string; text: string }
  | { kind: "askCount"; lineItemId: string; name: string; remaining: number; text: string }
  | { kind: "refuse"; text: string; tone: "warning" | "error" };

/** Per-unit keys for a bulk de-prep of `count` units: the `id:idx` shape every stage verb already counts. */
export const bulkDeprepKeys = (lineItemId: string, count: number): string[] =>
  Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => `${lineItemId}:${i}`);

/** One scan de-preps exactly ONE unit (a per-unit key); a kit goes whole; a bulk tag asks for the count. */
export function planDeprepScan(r: DeprepScanResult): DeprepPlan {
  switch (r.kind) {
    case "none": return { kind: "refuse", tone: "warning", text: "Asset not found" };
    case "refuse": return { kind: "refuse", tone: "error", text: r.text };
    case "kit": return { kind: "keys", keys: [r.lineItemId], text: `De-prepping kit ${r.name}` };
    case "unit": return { kind: "keys", keys: bulkDeprepKeys(r.lineItemId, 1), text: `De-prepping ${r.name}` };
    case "accessory": return { kind: "accessoryUnit", unitId: r.unitId, text: `De-prepping accessory ${r.name}` };
    case "bulk": return { kind: "askCount", lineItemId: r.lineItemId, name: r.name, remaining: r.remaining, text: `${r.name}: count what came back (${r.remaining} waiting)` };
  }
}
