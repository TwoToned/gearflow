/**
 * Shared style tokens for the react-pdf component library (#1152, building on
 * the #1151 spike's standalone quote proof-of-concept).
 *
 * Mirrors the color/size constants gearflow-table.ts and the other pdfme
 * plugins hard-code, so this is a fair visual comparison rather than a
 * from-scratch redesign. react-pdf's style system accepts "mm" as a unit
 * directly (@react-pdf/stylesheet's VALUE_REGEX) — every measurement below is
 * expressed in the SAME mm units `template-constants.ts` already uses, with
 * zero pt<->mm conversion. That's one whole class of the pdfme pipeline's
 * historical bugs (PT_PER_MM drift, #1149) that structurally cannot occur
 * here — see the spike findings doc.
 */
import { MARGIN, FOOTER_HEIGHT } from "@/lib/pdfme/template-constants";

export const PAGE_MARGIN = `${MARGIN}mm`;
export const PAGE_FOOTER_HEIGHT = `${FOOTER_HEIGHT}mm`;
// No PAGE_CONTENT_WIDTH export: pdfme needs `CONTENT_WIDTH` because every
// absolutely-positioned schema has to be told its own width in mm. A
// react-pdf block element doesn't — it's 100% of its parent by default — so
// there's no call site for that constant here. One more thing the old
// pipeline tracked by hand that this one gets for free.

export const COLORS = {
  text: "#1a1a1a",
  label: "#666666",
  muted: "#999999",
  note: "#888888",
  childText: "#555555",
  grandchildText: "#777777",
  border: "#eeeeee",
  headerBorder: "#dddddd",
  headerBg: "#f5f5f5",
  altRow: "#fafafa",
  footerText: "#999999",
  footerBorder: "#eeeeee",
};

// Badge styles — byte-identical hex values to gearflow-table.ts's
// BADGE_STYLES (pdfme's version is already a plain hex-string object, so
// there's nothing to convert; this is a straight port). Warehouse docs
// (packing-list/return-sheet/delivery-docket) and quote/invoice both read
// this — only `config.showBadges` (off for clientFacingTable) gates whether
// any of it ever renders.
export const BADGE_STYLES = {
  optional: { bg: "#fef3c7", text: "#92400e", label: "OPTIONAL" },
  overbooked: { bg: "#fee2e2", text: "#dc2626", label: "OVERBOOKED" },
  overbookedInherited: { bg: "#fef3c7", text: "#d97706", label: "OVERBOOKED" },
  reducedStock: { bg: "#ede9fe", text: "#7c3aed", label: "REDUCED STOCK" },
  subhire: { bg: "#cffafe", text: "#0891b2", label: "SUBHIRE" },
  // WS11 (#950) — sale lines ride in their existing category/group (no
  // separate Sales bucket, spec decision) — the badge is what differentiates.
  sale: { bg: "#dcfce7", text: "#15803d", label: "SALE" },
} as const;

export type BadgeStyle = (typeof BADGE_STYLES)[keyof typeof BADGE_STYLES];

// A muted grey used only for the child/grandchild category column — kept as
// its own token (not folded into COLORS above) because it's one-off in the
// pdfme original too (hexToRgb("#aaaaaa") inlined at both call sites rather
// than a named constant).
export const CATEGORY_MUTED = "#aaaaaa";

export const FONT_SIZE = {
  title: 22,
  orgName: 18,
  base: 9,
  child: 8,
  grandchild: 7,
  badge: 6,
  note: 7,
  footer: 7,
  headerLabel: 7,
};

/** Lighten a hex color toward white — port of pdfme's `lightenHex` (helpers.ts)
 *  so the group-header band color derives from the org's document color the
 *  same way. Not imported directly: the pdfme original blends in a pdf-lib
 *  `rgb()` context; this is the plain hex-string version react-pdf's `color`/
 *  `backgroundColor` style props take directly. */
export function lightenHex(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lr = Math.round((r + (1 - r) * amount) * 255);
  const lg = Math.round((g + (1 - g) * amount) * 255);
  const lb = Math.round((b + (1 - b) * amount) * 255);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}
