/** One printable label: a tag as a QR code plus a caption (UX Phase 12, `Print labels for all`). */
export interface ModelLabel {
  kind: "serialized" | "bulk";
  tag: string;
  caption: string;
}

interface LabelUnit { assetTag: string; status?: string | null; isActive?: boolean | null; customName?: string | null }
interface LabelStock { assetTag: string; status?: string | null; isActive?: boolean | null; totalQuantity?: number | null }

/**
 * Every label a model's page can print: its serialised units and its bulk stock tags, in tag
 * order. A RETIRED (or inactive) record is left out: its tag is no longer on a unit anyone
 * handles. A plain module so the dialog and its test share one rule for "which units".
 */
export function modelLabels(modelName: string, assets: LabelUnit[], bulk: LabelStock[]): ModelLabel[] {
  const live = (r: { status?: string | null; isActive?: boolean | null }) => r.isActive !== false && r.status !== "RETIRED";
  const serialised = assets.filter(live).map((a): ModelLabel => ({ kind: "serialized", tag: a.assetTag, caption: a.customName || modelName }));
  const stock = bulk.filter(live).map((b): ModelLabel => ({ kind: "bulk", tag: b.assetTag, caption: `${modelName} · bulk${b.totalQuantity != null ? ` × ${b.totalQuantity}` : ""}` }));
  return [...serialised, ...stock].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
}
