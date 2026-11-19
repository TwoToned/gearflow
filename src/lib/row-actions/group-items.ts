import { ACTION_GROUPS, type ActionGroupKey, type ActionItem } from "@/lib/primitives/types";

export interface ActionItemGroup {
  group: ActionGroupKey;
  items: ActionItem[];
}

/** Items bucketed by group in the fixed `ACTION_GROUPS` order; empty groups dropped. */
export function groupActionItems(items: ActionItem[]): ActionItemGroup[] {
  return ACTION_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Finds the (top-level or one-level) item a bare key press triggers. */
export function itemForShortcut(items: ActionItem[], key: string): ActionItem | undefined {
  const k = key.toLowerCase();
  return items.find((i) => !i.children?.length && i.kbd?.toLowerCase() === k);
}
