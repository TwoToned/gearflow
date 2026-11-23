import { formatCurrency, formatWeekdayDayMonth } from "@/lib/formatters";
import { plural } from "@/lib/list-write-toast";

/**
 * The words on a Versions-tab row (spec §7b.4). Pure: the facts come from the
 * ONE bounded read (`versionsPreview.versionRowFacts`), already derived on the
 * server, so nothing here re-derives a diff or a total (R-3.1).
 */

export interface VersionRowDiff {
  vsNumber: number;
  added: number;
  removed: number;
  changed: number;
  totalDelta: number;
}

export interface VersionRowFacts {
  versionId: string;
  lineCount: number;
  /** `null` = not counted (older versions, or a large job). */
  plannedCount: number | null;
  total: number;
  quoteStatus: string | null;
  diff: VersionRowDiff | null;
}

export interface VersionRowSource {
  number: number;
  label?: string;
  isLive: boolean;
  contentState: "ready" | "missing";
  createdAt: number;
}

/** `v3 · Live · Hilton revision`. */
export function versionTitle(v: Pick<VersionRowSource, "number" | "label" | "isLive">): string {
  return [`v${v.number}`, v.isLive ? "Live" : null, v.label].filter(Boolean).join(" · ");
}

/** `Thu 6 Nov` for the mono date column. */
export function versionDate(createdAt: number): string {
  return formatWeekdayDayMonth(createdAt);
}

const QUOTE_WORDS: Record<string, string> = {
  DRAFT: "quote draft",
  PUBLISHED: "quote sent",
  SENT: "quote sent",
  ACCEPTED: "quote accepted",
  DECLINED: "quote declined",
  EXPIRED: "quote expired",
  SUPERSEDED: "quote superseded",
};

function quoteWord(status: string | null): string | null {
  return status ? (QUOTE_WORDS[status] ?? null) : null;
}

/** `44 lines · 36 planned · quote sent`, or `no captured content` when the version holds none. */
export function versionFactLine(v: Pick<VersionRowSource, "contentState">, facts: VersionRowFacts | undefined): string | null {
  if (v.contentState === "missing") return "no captured content";
  if (!facts) return null;
  const planned = facts.plannedCount == null ? null : `${facts.plannedCount} planned`;
  return [plural(facts.lineCount, "line"), planned, quoteWord(facts.quoteStatus)].filter(Boolean).join(" · ");
}

function signedMoney(n: number): string {
  return `${n >= 0 ? "+" : "−"}${formatCurrency(Math.abs(n), undefined, { cents: false })}`;
}

/** `vs v2: +2 lines · −1 line · 3 lines changed · +$1,970`; null when nothing differs or there is no older version. */
export function versionDiffLine(diff: VersionRowDiff | null): string | null {
  if (!diff) return null;
  const parts = [
    diff.added > 0 ? `+${plural(diff.added, "line")}` : null,
    diff.removed > 0 ? `−${plural(diff.removed, "line")}` : null,
    diff.changed > 0 ? `${plural(diff.changed, "line")} changed` : null,
    diff.totalDelta !== 0 ? signedMoney(diff.totalDelta) : null,
  ].filter(Boolean);
  return parts.length > 0 ? `vs v${diff.vsNumber}: ${parts.join(" · ")}` : `vs v${diff.vsNumber}: no change`;
}

/** `versionsPreview.makeLivePreview`'s shape: COUNTS ONLY, derived on read. */
export interface MakeLivePreview {
  incomingNumber: number;
  outgoingNumber: number;
  lines: { incoming: number; outgoing: number };
  carriedLines: number;
  packedUnits: number;
  notOnIncoming: number;
  modelsWithDemandChange: number;
  invoiceCount: number;
  total: { before: number; after: number };
  balance: { before: number; after: number };
  truncated: boolean;
}

function moneyShift(pair: { before: number; after: number }): string {
  const fmt = (n: number) => formatCurrency(n, undefined, { cents: false });
  return pair.before === pair.after ? fmt(pair.after) : `${fmt(pair.before)} → ${fmt(pair.after)}`;
}

/**
 * The Make-live dialog's calm rows (Warehouse, Availability, Invoices), in the
 * prototype's words. Counts only; nothing here is a verdict and none blocks.
 */
export function makeLivePreviewRows(p: MakeLivePreview): { label: string; text: string }[] {
  const packed = p.packedUnits > 0 ? ` ${plural(p.packedUnits, "packed unit")} carry over.` : "";
  const strand = p.notOnIncoming > 0 ? ` ${plural(p.notOnIncoming, "line")} with packed gear ${p.notOnIncoming === 1 ? "isn’t" : "aren’t"} on v${p.incomingNumber}.` : "";
  const demand =
    p.modelsWithDemandChange > 0
      ? `Demand changes on ${plural(p.modelsWithDemandChange, "model")}. Re-checked after, never a block.`
      : "No change in demand.";
  const invoices =
    p.invoiceCount > 0 ? `${plural(p.invoiceCount, "invoice")} stay${p.invoiceCount === 1 ? "s" : ""} as ${p.invoiceCount === 1 ? "it is" : "they are"}. ` : "";
  return [
    { label: "Warehouse", text: `The pick list follows v${p.incomingNumber}: ${plural(p.lines.incoming, "line")}.${packed}${strand}` },
    { label: "Availability", text: demand },
    { label: "Invoices", text: `${invoices}Quote total ${moneyShift(p.total)}. Balance to raise ${moneyShift(p.balance)}.` },
  ];
}

/** The right-aligned mono total, whole dollars (lists, playbook §3.7). */
export function versionTotalText(facts: VersionRowFacts | undefined): string {
  return facts ? formatCurrency(facts.total, undefined, { cents: false }) : "";
}
