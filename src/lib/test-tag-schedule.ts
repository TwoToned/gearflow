import { listWriteTitle, plural } from "@/lib/list-write-toast";

/** One item the `Schedule…` verb is offered for: its linked inventory asset is what a maintenance job is about. */
export interface ScheduleItem {
  id: string;
  testTagId: string;
  /** The linked serialised asset's id; a bulk-linked or unlinked item has none. */
  assetId: string | null;
  /** A retired item is not tested again: it is named as skipped, never booked. */
  retired?: boolean;
}

/**
 * `Schedule…` plans ONE scheduled Test & tag maintenance job covering the items' linked assets. A retired item, or one with no
 * linked asset (nothing a job can be booked against), is NAMED as skipped with its reason, never silently dropped. Pure.
 */
export function planTestSchedule(items: ScheduleItem[]): { assetIds: string[]; skipped: { name: string; why: string }[] } {
  const assetIds: string[] = [];
  const skipped: { name: string; why: string }[] = [];
  for (const it of items) {
    if (it.retired) skipped.push({ name: it.testTagId, why: "retired" });
    else if (!it.assetId) skipped.push({ name: it.testTagId, why: "no linked asset" });
    else if (!assetIds.includes(it.assetId)) assetIds.push(it.assetId);
  }
  return { assetIds, skipped };
}

export const testScheduleTitle = (items: ScheduleItem[]): string => (items.length === 1 ? `Test & tag: ${items[0].testTagId}` : `Test & tag: ${plural(items.length, "item")}`);

export function testScheduleToast(assetCount: number, skipped: { name: string; why: string }[]): string {
  return listWriteTitle(`Scheduled testing for ${plural(assetCount, "asset")}`, skipped);
}
