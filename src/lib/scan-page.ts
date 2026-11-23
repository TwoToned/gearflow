/**
 * The Scan page's pure client logic (Phase 16, spec §9i): the URL contract, the
 * Last scans entries and their head counts, and the card's derived words. The card
 * itself comes from the server (`scanLookup.checkCard` / `testCard`); nothing here
 * re-derives a fact the server owns.
 */
import { z } from "zod";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { GEAR_STAGE_LABELS, OUT_LABEL } from "@/lib/vocabulary";

export type ScanCardData = FunctionReturnType<typeof api.scanLookup.checkCard>;

// ─── URL ─────────────────────────────────────────────────────────────────────

const SCAN_MODES = ["check", "tt"] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

export const SCAN_MODE_LABELS: Record<ScanMode, string> = { check: "Check", tt: "Test & tag" };

/** A tag as the server's lookup accepts it (`scanLookup`'s SAFE_TAG). */
const TAG = /^[A-Za-z0-9\-_.:/ ]+$/;

/** Each field falls back on a bad value, never throws. `mode: null` = the first one held. */
const scanUrlSchema = z.object({
  mode: z.enum(SCAN_MODES).nullable().catch(null),
  tag: z.string().trim().min(1).max(128).regex(TAG).nullable().catch(null),
});
export type ScanUrlState = z.output<typeof scanUrlSchema>;

export function parseScanUrl(params: { get: (k: string) => string | null }): ScanUrlState {
  return scanUrlSchema.parse({ mode: params.get("mode"), tag: params.get("tag") });
}

/** `/scan?mode=check&tag=AURA-01` (defaults omitted). */
export function scanHref(state: { mode: ScanMode | null; tag: string | null }): string {
  const q = new URLSearchParams();
  if (state.mode) q.set("mode", state.mode);
  if (state.tag) q.set("tag", state.tag);
  const s = q.toString();
  return s ? `/scan?${s}` : "/scan";
}

/** The mode to show: the URL's when the user holds it, else the first one they hold. */
export function effectiveMode(requested: ScanMode | null, held: readonly ScanMode[]): ScanMode | null {
  if (requested && held.includes(requested)) return requested;
  return held[0] ?? null;
}

// ─── Last scans (§9i.4) ──────────────────────────────────────────────────────

/** How long a saved row offers Undo (the toast's own window). */
export const LAST_SCAN_UNDO_MS = 10_000;
export const LAST_SCANS_SHOWN = { desktop: 5, phone: 3 } as const;

export type LastScanVerdict = "clean" | "failed" | "unknown" | "kit" | "bulk" | "ttOnly" | "noItems";

export interface LastScan {
  id: string;
  mode: ScanMode;
  tag: string;
  /** The model or item name, when known. */
  name: string | null;
  verdict: LastScanVerdict;
  at: number;
  assetId: string | null;
  /** The save's ONE undo closure (the toast's own), while inside its window. */
  undo?: () => Promise<void>;
}

export const VERDICT_WORDS: Record<LastScanVerdict, string> = {
  clean: "Saved",
  failed: "Saved · failed",
  unknown: "No asset carries this tag",
  kit: "Kit tag",
  bulk: "Bulk stock",
  ttOnly: "Not in inventory",
  noItems: "No check items",
};

export const VERDICT_TONE: Record<LastScanVerdict, "success" | "warning" | "error" | "info"> = {
  clean: "success",
  failed: "error",
  unknown: "error",
  kit: "info",
  bulk: "info",
  ttOnly: "info",
  noItems: "warning",
};

/** The card kind an exception scan logs as, or `null` when the card can be checked. */
export function exceptionVerdict(card: ScanCardData): LastScanVerdict | null {
  if (card.kind !== "asset") return card.kind;
  return card.checkItemCount === 0 ? "noItems" : null;
}

export type CheckableCard = ScanCardData & { kind: "asset"; asset: NonNullable<ScanCardData["asset"]> };

/** The card, when it is a serialised asset with check items (Check mode can check it). */
export function checkableCard(card: ScanCardData | undefined): CheckableCard | null {
  if (card?.kind !== "asset" || !card.asset || card.checkItemCount === 0) return null;
  return card as CheckableCard;
}

/** The name a Last scans row shows for whatever the tag turned out to be. */
export function scanCardName(card: ScanCardData): string | null {
  return card.asset?.modelName ?? card.kit?.name ?? card.bulk?.modelName ?? card.tt?.description ?? null;
}

/** The asset (or bulk stock) record a row's `Open asset` opens; `null` when there is none. */
export function scanCardAssetId(card: ScanCardData): string | null {
  return card.asset?.id ?? card.bulk?.id ?? null;
}

/** `Last scans 7 · 6 clean · 1 failed` — saved rows only are counted as clean/failed. */
export function lastScansHead(entries: LastScan[]): { count: number; summary: string } {
  const clean = entries.filter((e) => e.verdict === "clean").length;
  const failed = entries.filter((e) => e.verdict === "failed").length;
  const parts = [clean ? `${clean} clean` : null, failed ? `${failed} failed` : null].filter(Boolean);
  return { count: entries.length, summary: parts.join(" · ") };
}

/** `14:05` — the row's time, 24-hour, in mono. */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── The card's words ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** `T&T overdue 38d` / `T&T due in 4d` / `T&T failed` — null when nothing to flag. */
export function ttFlag(tt: ScanCardData["tt"], now: number): { label: string; tone: "error" | "warning" } | null {
  if (!tt || !tt.isActive) return null;
  if (tt.status === "FAILED") return { label: "T&T failed", tone: "error" };
  if (tt.nextDueDate == null) return null;
  const days = Math.floor((tt.nextDueDate - now) / DAY_MS);
  if (days < 0) return { label: `T&T overdue ${-days}d`, tone: "error" };
  if (tt.status === "DUE_SOON") return { label: `T&T due in ${days}d`, tone: "warning" };
  return null;
}

/** The unit's state on its job, in the gear-stage words (`vocabulary.ts`). */
export const JOB_STATE_WORDS: Record<NonNullable<ScanCardData["job"]>["state"], string> = {
  to_pick: GEAR_STAGE_LABELS.to_prep,
  packed: GEAR_STAGE_LABELS.prepped,
  out: OUT_LABEL,
};
