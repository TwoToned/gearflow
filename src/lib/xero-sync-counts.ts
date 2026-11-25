/**
 * The Finance tab's one-line Xero summary (UX Phase 10, spec §8b): how many of
 * this job's issued invoices are synced, still to push, or failed. DERIVED from
 * the invoice rows already loaded; nothing is stored. Drafts and voids are not
 * pushable, and a credit note counts like any other issued document.
 */
export function xeroSyncCounts(invoices: readonly { status: string; xeroSyncStatus?: string | null }[]): {
  synced: number;
  toPush: number;
  failed: number;
} {
  const issued = invoices.filter((i) => i.status === "ISSUED");
  const synced = issued.filter((i) => i.xeroSyncStatus === "SYNCED").length;
  const failed = issued.filter((i) => i.xeroSyncStatus === "ERROR").length;
  return { synced, failed, toPush: issued.length - synced - failed };
}
