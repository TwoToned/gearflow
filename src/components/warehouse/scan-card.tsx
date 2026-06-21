"use client";

import { Fragment } from "react";
import { ChevronRight, Container } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { focusRing } from "@/lib/utils";

/**
 * Mobile card-list primitives for the warehouse scan tabs (§15 — phones use
 * stacked cards, not data tables). These render the SAME grouped data and the
 * SAME selection / expand handlers as the desktop `<Table>`; they are an
 * additive responsive presentation only (no data or mutation logic lives here).
 *
 * Each interactive surface clears the 44px touch-target minimum: the whole card
 * is a ≥44px tappable row, and the leading control column is min-w-11.
 */

/** A single selectable line rendered as a tappable card row. */
export function ScanItemCard({
  selected,
  onToggleSelect,
  name,
  badges,
  subtext,
  assetTag,
  qtyLabel,
  status,
  indent = false,
}: {
  selected: boolean;
  onToggleSelect: () => void;
  name: React.ReactNode;
  badges?: React.ReactNode;
  subtext?: React.ReactNode;
  assetTag: React.ReactNode;
  qtyLabel: React.ReactNode;
  status: React.ReactNode;
  /** Nested (child / unit) rows sit on a subtle inset and indent the content. */
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggleSelect}
      aria-pressed={selected}
      className={`flex w-full min-h-11 items-center gap-3 rounded-[var(--r)] px-3 py-2.5 text-left transition-colors hover:bg-elev active:bg-elev ${focusRing} ${
        indent ? "bg-paper-2/40 pl-8" : "bg-card ring-1 ring-line"
      }`}
    >
      <span className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Checkbox checked={selected} className="pointer-events-none" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-ui-text text-ink">{name}</span>
          {badges}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="t-mono text-caption text-muted">{assetTag}</span>
          <span className="text-caption text-muted tabular-nums">Qty {qtyLabel}</span>
        </div>
        {subtext}
      </div>
      <span className="shrink-0">{status}</span>
    </button>
  );
}

/** A kit / group header card — tappable to expand, with its own selection box. */
export function ScanGroupCard({
  selected,
  selectedState,
  onToggleSelect,
  expanded,
  onToggleExpand,
  name,
  badges,
  subtext,
  assetTag,
  qtyLabel,
  status,
  showKitGlyph = false,
  children,
}: {
  /** For a kit group: the group's own line id selection. */
  selected?: boolean;
  /** For a serialized/bulk group: tri-state across child keys. */
  selectedState?: boolean | "indeterminate";
  onToggleSelect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  name: React.ReactNode;
  badges?: React.ReactNode;
  subtext?: React.ReactNode;
  assetTag?: React.ReactNode;
  qtyLabel: React.ReactNode;
  status: React.ReactNode;
  showKitGlyph?: boolean;
  /** Child cards, shown only when expanded. */
  children?: React.ReactNode;
}) {
  const checkboxState = selectedState ?? !!selected;
  return (
    <Fragment>
      <div className="flex w-full min-h-11 items-center gap-2 rounded-[var(--r)] bg-paper-2/60 px-3 py-2.5">
        <span
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox checked={checkboxState} onCheckedChange={onToggleSelect} />
        </span>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r)] text-left ${focusRing}`}
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
          {showKitGlyph && <Container className="h-4 w-4 shrink-0 text-muted" />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-ui-text text-ink">{name}</span>
              {badges}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2">
              {assetTag != null && <span className="t-mono text-caption text-muted">{assetTag}</span>}
              <span className="text-caption text-muted tabular-nums">Qty {qtyLabel}</span>
            </span>
            {subtext}
          </span>
        </button>
        <span className="shrink-0">{status}</span>
      </div>
      {expanded && children}
    </Fragment>
  );
}

/** A verify-toggle child card (kit children in deploy/return) — no selection box. */
export function ScanVerifyCard({
  verified,
  onToggleVerify,
  name,
  badges,
  assetTag,
  qtyLabel,
  status,
}: {
  verified: boolean;
  onToggleVerify: () => void;
  name: React.ReactNode;
  badges?: React.ReactNode;
  assetTag: React.ReactNode;
  qtyLabel: React.ReactNode;
  status: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggleVerify}
      aria-pressed={verified}
      aria-label={verified ? "Verified — tap to clear" : "Tap to verify present"}
      className={`flex w-full min-h-11 items-center gap-3 rounded-[var(--r)] px-3 py-2.5 pl-8 text-left transition-colors hover:bg-elev active:bg-elev ${focusRing} ${
        verified ? "bg-ok-soft/50" : "bg-paper-2/40"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-ui-text text-ink">{name}</span>
          {badges}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="t-mono text-caption text-muted">{assetTag}</span>
          <span className="text-caption text-muted tabular-nums">Qty {qtyLabel}</span>
        </div>
      </div>
      <span className="shrink-0">
        {verified ? <Badge status="ok">Verified</Badge> : status}
      </span>
    </button>
  );
}

/** A container / no-container section heading inside a mobile card list. */
export function ScanContainerHeading({
  label,
  muted = false,
  action,
}: {
  label: React.ReactNode;
  muted?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 pt-2">
      <div className={`flex items-center gap-1.5 text-caption font-semibold ${muted ? "text-faint" : "text-ink-2"}`}>
        <Container className="h-3.5 w-3.5" />
        {label}
      </div>
      {action}
    </div>
  );
}
