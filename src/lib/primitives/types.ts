/**
 * The shared contract between the UX unification primitives (spec §5,
 * docs/designs/ux-unification-2026-10.md). Phase 1a OWNS this file; Phase 1b
 * and every surface phase import from it and never redeclare these shapes
 * (R-3.1). A change here goes through 1a (or the overseer after 1a merges).
 *
 * Types only: no React runtime import, so `src/lib/row-actions/*` builders
 * and tests can use it.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { ColorIntent } from "@/lib/status-colors";

// ─── ActionMenu (§5.2) ───────────────────────────────────────────────────

/** Fixed groups in a fixed order (principle 2). The renderer sorts by this. */
export const ACTION_GROUPS = ["edit", "organise", "documents", "reporting", "danger"] as const;
export type ActionGroupKey = (typeof ACTION_GROUPS)[number];

export interface ActionConfirm {
  title: string;
  /** Says what happens downstream (reservations, documents, history). */
  body: string;
  confirmLabel: string;
}

export interface ActionItem {
  key: string;
  label: string;
  group: ActionGroupKey;
  onSelect: () => void | Promise<void>;
  icon?: LucideIcon;
  /** Single-key shortcut shown in the menu; E / M / D stay (§5.2). */
  kbd?: string;
  /** Red and last. Must carry `confirm` (playbook §3.4). */
  danger?: boolean;
  confirm?: ActionConfirm;
  /** One level of sub-items (e.g. Move to ▸ case). */
  children?: ActionItem[];
}

/**
 * Built by one function per row kind (`src/lib/row-actions/<kind>.ts`). The
 * builder evaluates every `when` itself: an action that does not apply is
 * ABSENT from the spec, never disabled (principle 2), so there is no
 * `disabled` field.
 */
export interface ActionMenuSpec {
  items: ActionItem[];
}

export type RowActionBuilder<Row, Ctx> = (row: Row, ctx: Ctx) => ActionMenuSpec;

/** A bulk verb. The label carries the count: `Force return 3` (playbook §3.5). */
export interface BulkAction extends Omit<ActionItem, "label" | "children"> {
  label: (count: number) => string;
}

export type BulkActionBuilder<Row, Ctx> = (rows: Row[], ctx: Ctx) => BulkAction[];

// ─── Status (§5.3, D91) ──────────────────────────────────────────────────

/** Input to `StatusWord`: a dot and a word, never a filled pill. */
export interface StatusValue {
  label: string;
  intent: ColorIntent;
  /** Closed stage: neutral outline dot (D2). */
  outline?: boolean;
}

// ─── State glyphs (§5.4) ─────────────────────────────────────────────────

export type StateGlyphKey =
  | "priceHidden"
  | "hiddenOnDocs"
  | "excludedFromRoi"
  | "optional"
  | "manualPrice"
  | "needsCheck"
  | "plannedCase"
  | "accessoriesModified";

export interface StateGlyph {
  key: StateGlyphKey;
  /** Tooltip text, e.g. `Planned → LX-04`. */
  tooltip: string;
}

// ─── LineRow (§5.1) ──────────────────────────────────────────────────────

export type RowKind =
  | "gear"
  | "kit"
  | "group"
  | "subhire"
  | "custom"
  | "sale"
  | "container"
  | "service"
  | "crew"
  | "asset";

/**
 * A typed fact. The parent decides which facts become desktop columns; the
 * phone folds them into the subtitle with the first qty/money fact on the
 * right. Money uses the same unit the row stores; `null` is BLANK, never $0
 * (CLAUDE.md "$0 is a PRICE").
 */
export type Fact =
  | { kind: "qty"; value: number; of?: number; unit?: string }
  | { kind: "money"; amount: number | null }
  | { kind: "availability"; state: "ok" | "short" | "unknown"; free?: number; short?: number }
  | { kind: "time"; at: string }
  | { kind: "dateRange"; start: string; end: string }
  | { kind: "place"; label: string }
  | { kind: "people"; names: string[] }
  | { kind: "text"; label: string };

/** Inline dot-word after the title: `Short 2` (error), `Needs check` (warning). */
export interface RowFlag {
  label: string;
  tone: "error" | "warning";
}

export interface LineRowData {
  id: string;
  kind: RowKind;
  title: string;
  subtitle?: string;
  /** Muted text after a middle dot. */
  tags?: string[];
  glyphs?: StateGlyph[];
  flags?: RowFlag[];
  /** Keyed by the parent's column ids. */
  facts: Record<string, Fact>;
  status?: StatusValue;
  menu?: ActionMenuSpec;
  /** One level: kit members, accessories, group members, bulk units, crew. 44 px, no actions. */
  children?: LineRowData[];
  /** Whole-row open (desktop: navigate/expand; phone: the RowEditorSheet when editable). */
  href?: string;
  onOpen?: () => void;
}

// Not in the type on purpose: spec §5.1's `primary?` per-row button. Playbook
// §3.4 and §10 rejected per-row buttons everywhere; the one survivor (the
// warehouse accessory row's `Pack 5 with parent`, §9.5) is added by Phase 3
// through this file, not invented per surface.

export interface FactColumn {
  id: string;
  header: string;
  align?: "start" | "end";
  /** Columns beyond 8 are opt-in from ⋯ › Columns (playbook §3.8). */
  optional?: boolean;
}

// ─── Selection (playbook §3.5) ───────────────────────────────────────────

/** Returned by 1a's `useRowSelection(visibleIds)`; BulkBar (1b) reads it. */
export interface RowSelection {
  selected: ReadonlySet<string>;
  /** Shift extends over the visible range in DOM order. */
  toggle: (id: string, opts?: { shift?: boolean }) => void;
  togglePage: () => void;
  clear: () => void;
  count: number;
}

// ─── Totals (§5.6) ───────────────────────────────────────────────────────

/** A derived footer total; never stored (FEATUREDOCS/74). */
export interface TotalLine {
  label: string;
  amount: number | null;
  /** Muted sub-line, e.g. `incl. GST`. */
  note?: ReactNode;
}
