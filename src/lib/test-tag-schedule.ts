import { listWriteTitle, plural } from "@/lib/list-write-toast";

/** One item the `Schedule…` verb is offered for: its linked inventory asset is what a maintenance job is about. */
export interface ScheduleItem {
  id: string;
  testTagId: string;
  /** The linked serialised asset's id; a bulk-linked or unlinked item has none. */
  assetId: string | null;
}

/**
 * `Schedule…` plans ONE scheduled Test & tag maintenance job covering the items' linked assets. An item with no linked
 * asset has nothing a job can be booked against, so it is NAMED as skipped, never silently dropped. Pure.
 */
export function planTestSchedule(items: ScheduleItem[]): { assetIds: string[]; skipped: { name: string; why: string }[] } {
  const assetIds: string[] = [];
  const skipped: { name: string; why: string }[] = [];
  for (const it of items) {
    if (!it.assetId) skipped.push({ name: it.testTagId, why: "no linked asset" });
    else if (!assetIds.includes(it.assetId)) assetIds.push(it.assetId);
  }
  return { assetIds, skipped };
}

export const testScheduleTitle = (items: ScheduleItem[]): string => (items.length === 1 ? `Test & tag: ${items[0].testTagId}` : `Test & tag: ${plural(items.length, "item")}`);

export function testScheduleToast(assetCount: number, skipped: { name: string; why: string }[]): string {
  return listWriteTitle(`Scheduled testing for ${plural(assetCount, "asset")}`, skipped);
}
