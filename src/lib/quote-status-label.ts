/**
 * A quote's human status word (UX Phase 10, spec §8b: Draft · Sent · Accepted ·
 * Declined · Expired · Recalled · Superseded), from the DERIVED status
 * (`effectiveQuoteStatus`) — never the stored column. The deprecated
 * `PUBLISHED` reads as Sent; anything unknown is title-cased rather than shown
 * as a raw enum.
 */
const LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PUBLISHED: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  RECALLED: "Recalled",
  SUPERSEDED: "Superseded",
};

export function quoteStatusLabel(effectiveStatus: string): string {
  return LABELS[effectiveStatus] ?? effectiveStatus.charAt(0) + effectiveStatus.slice(1).toLowerCase();
}
