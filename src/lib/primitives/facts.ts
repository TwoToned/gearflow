import { formatCurrency } from "@/lib/formatters";
import type { Fact } from "@/lib/primitives/types";


const FORMATTERS: { [K in Fact["kind"]]: (f: Extract<Fact, { kind: K }>) => string } = {
  qty: (f) => `${f.of != null ? `${f.value}/${f.of}` : f.value}${f.unit ? ` ${f.unit}` : ""}`,
  // null is BLANK (an em dash), never $0 (CLAUDE.md "$0 is a PRICE").
  money: (f) => formatCurrency(f.amount),
  availability: (f) => {
    if (f.state === "short") return `Short ${f.short ?? ""}`.trim();
    if (f.state === "ok") return f.free != null ? `${f.free} free` : "Free";
    return "Not checked";
  },
  time: (f) => f.at,
  dateRange: (f) => `${f.start} – ${f.end}`,
  place: (f) => f.label,
  people: (f) => f.names.join(", "),
  text: (f) => f.label,
};

/** One fact as plain text: the desktop cell body and the phone subtitle part. */
export function factText(fact: Fact): string {
  return (FORMATTERS[fact.kind] as unknown as (f: Fact) => string)(fact);
}

function isRightFact(fact: Fact): boolean {
  return fact.kind === "qty" || fact.kind === "money";
}

/**
 * Phone: the first qty/money fact goes on the right of the card, the rest fold
 * into the subtitle in column order (spec §5.1).
 */
export function splitPhoneFacts(
  columnIds: string[],
  facts: Record<string, Fact>,
): { right?: Fact; folded: Fact[] } {
  const ordered = columnIds.map((id) => facts[id]).filter((f): f is Fact => !!f);
  const right = ordered.find(isRightFact);
  return { right, folded: ordered.filter((f) => f !== right) };
}
