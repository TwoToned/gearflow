import type { ActionItem } from "@/lib/primitives/types";
import type { LabelIndexEntry } from "@/lib/pdfme/container-labels";

type OpenLabel = (type: "container-label" | "kit-label" | "item-label", labelId?: string) => void;

const entry = (l: LabelIndexEntry) => (l.tag ? `${l.title} (${l.tag})` : l.title);

/**
 * "All X" plus one pick per label the job would print (the API's `list=1` answer), as one Documents entry.
 * Exported for the job page's Documents ▾, which lists case labels the same way (it has no case list of its own).
 */
export function labelGroup(
  key: string, title: string, allLabel: string, type: "container-label" | "kit-label" | "item-label", labels: LabelIndexEntry[] | null, open: OpenLabel,
): ActionItem {
  return {
    key, label: title, group: "documents", onSelect: () => open(type),
    children: [
      { key: `${key}-all`, label: allLabel, group: "documents", onSelect: () => open(type) },
      ...(labels ?? []).map((l): ActionItem => ({ key: `${key}-${l.id}`, label: entry(l), group: "documents", onSelect: () => open(type, l.id) })),
    ],
  };
}

/**
 * The warehouse Documents menu's label entries: per-case picks (a case label each), and per-kit / per-item
 * picks under their own submenu. `kit`/`item` are `null` while the list loads (the "All" entry still works).
 */
export function labelActionItems(p: {
  containers: ReadonlyArray<{ id: string; label: string }>;
  kit: LabelIndexEntry[] | null;
  item: LabelIndexEntry[] | null;
  open: OpenLabel;
}): ActionItem[] {
  return [
    ...p.containers.map((c): ActionItem => ({ key: `label-${c.id}`, label: `Case label: ${c.label}`, group: "documents", onSelect: () => p.open("container-label", c.id) })),
    labelGroup("kit-labels", "Kit labels", "All kits", "kit-label", p.kit, p.open),
    labelGroup("item-labels", "Loose item labels", "All loose items", "item-label", p.item, p.open),
  ];
}
