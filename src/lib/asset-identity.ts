import type { NativeAssetDetail } from "@/lib/asset-detail-reconstruct";
import { conditionLabels, formatLabel } from "@/lib/status-labels";
import { formatDate } from "@/lib/formatters";

/** One line of the Overview's Identity block. A pure derivation, so it is tested without React. */
export interface IdentityRow {
  label: string;
  value: string;
  mono?: boolean;
  /** Where the value links (the test & tag record). */
  href?: string;
}

type Asset = NativeAssetDetail;

function specRows(asset: Asset): IdentityRow[] {
  const specs = (asset.model?.specifications ?? null) as unknown;
  const pairs: [string, string][] = Array.isArray(specs)
    ? (specs as { key: string; value: string }[]).map((s) => [s.key, s.value])
    : Object.entries((specs as Record<string, string> | null) ?? {});
  return pairs.map(([label, value]) => ({ label, value }));
}

function testTagRow(asset: Asset): IdentityRow[] {
  const t = asset.testTagAsset;
  if (!t || t.isActive === false) return [];
  const next = t.nextDueDate ? ` · next ${formatDate(t.nextDueDate)}` : "";
  return [{ label: "Test & tag", value: `${formatLabel(t.status ?? "—")}${next}`, href: `/test-and-tag/${t.id}` }];
}

/** Serial, barcode, condition, category, purchase date, the T&T record, then the model's specifications. Unset rows are absent. */
export function identityRows(asset: Asset): IdentityRow[] {
  const rows: (IdentityRow | false | null)[] = [
    !!asset.serialNumber && { label: "Serial", value: asset.serialNumber, mono: true },
    !!asset.barcode && { label: "Barcode", value: asset.barcode, mono: true },
    { label: "Condition", value: conditionLabels[asset.condition] ?? formatLabel(asset.condition) },
    asset.model?.category ? { label: "Category", value: asset.model.category.name } : null,
    asset.purchaseDate ? { label: "Purchased", value: formatDate(asset.purchaseDate) } : null,
  ];
  return [...rows.filter((r): r is IdentityRow => !!r), ...testTagRow(asset), ...specRows(asset)];
}
