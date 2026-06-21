"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PersonAvatar, avatarHue, type AvatarHue } from "@/components/ui/avatar";

/**
 * CrewScheduler — horizontal Gantt timeline (§15.4c).
 *
 * Layout: sticky name+avatar column on the left; horizontally-scrollable hour track on
 * the right — both move as one container so scroll stays in sync.
 *
 * Shift bars use the 8-colour categorical palette (§3.7). Bar labels follow the on-fill
 * rule: --dark on all hues in dark theme (bright fills); --primary-foreground on most
 * hues in light theme except amber/lime. Clash (overlapping shifts) → bg-out-soft +
 * border-t-out. Open slots → dashed border, no fill.
 *
 * DESIGN.md §15.4c · §3.7 on-fill rule · §9.1 focus-visible.
 */

// ─── types ────────────────────────────────────────────────────────────────────

export interface SchedulerShift {
  id: string;
  label: string;
  startHour: number;
  endHour: number;
  /** Falls back to avatarHue(row.name) when omitted. */
  color?: AvatarHue;
  /** Renders as a dashed open-call slot (no fill). */
  isOpen?: boolean;
}

export interface SchedulerRow {
  id: string;
  name: string;
  /** Avatar image URL — falls back to initials. */
  src?: string;
  shifts: SchedulerShift[];
}

export interface CrewSchedulerProps extends React.HTMLAttributes<HTMLDivElement> {
  rows: SchedulerRow[];
  /** Day / date label shown in the header name cell, e.g. "Thursday 12 Jun". */
  label?: string;
  startHour?: number;
  endHour?: number;
  /** Pixel width of one hour column. Determines scroll width. */
  hourWidth?: number;
  onShiftClick?: (shift: SchedulerShift, row: SchedulerRow) => void;
}

// ─── constants & helpers ──────────────────────────────────────────────────────

const NAME_COL = "10rem";
const ROW_H = 56;
const BAR_INSET = 6; // top/bottom margin so bars are 44px → ≥44px touch target (§16.8)

// On-fill rule (§3.7): dark theme bright fills → --dark; light theme deeper fills →
// --primary-foreground, except amber/lime which stay dark on both themes.
const ON_FILL: Record<AvatarHue, string> = {
  blue:   "text-dark [.light_&]:text-primary-foreground",
  amber:  "text-dark",
  green:  "text-dark [.light_&]:text-primary-foreground",
  purple: "text-dark [.light_&]:text-primary-foreground",
  coral:  "text-dark [.light_&]:text-primary-foreground",
  teal:   "text-dark [.light_&]:text-primary-foreground",
  pink:   "text-dark [.light_&]:text-primary-foreground",
  lime:   "text-dark",
};

const HUE_BG: Record<AvatarHue, string> = {
  blue: "bg-blue", amber: "bg-amber", green: "bg-green", purple: "bg-purple",
  coral: "bg-coral", teal: "bg-teal", pink: "bg-pink", lime: "bg-lime",
};

function getClashIds(shifts: SchedulerShift[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      const a = shifts[i], b = shifts[j];
      if (a.startHour < b.endHour && b.startHour < a.endHour) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return ids;
}

function fmt(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0
    ? `${hh % 12 || 12}${hh < 12 ? "am" : "pm"}`
    : `${hh % 12 || 12}:${String(mm).padStart(2, "0")}`;
}

// ─── component ────────────────────────────────────────────────────────────────

function CrewScheduler({
  rows,
  label,
  startHour = 8,
  endHour = 20,
  hourWidth = 64,
  onShiftClick,
  className,
  ...props
}: CrewSchedulerProps) {
  const hours = Array.from(
    { length: endHour - startHour + 1 },
    (_, i) => startHour + i,
  );
  const trackW = (endHour - startHour) * hourWidth;
  const totalW = `calc(${NAME_COL} + ${trackW}px)`;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-[var(--radius)] border-2 border-border bg-card text-ink",
        className,
      )}
      {...props}
    >
      {/* one scroll container — name col is sticky inside it */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: totalW }}>

          {/* ── header row ── */}
          <div className="flex border-b border-line">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center bg-paper-2 px-3 border-r border-line"
              style={{ width: NAME_COL, height: ROW_H }}
            >
              {label && (
                <span className="text-[11px] font-bold text-muted truncate">{label}</span>
              )}
            </div>
            {/* hour labels */}
            <div className="relative flex" style={{ width: trackW }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="shrink-0 border-r border-line px-1.5 flex items-center"
                  style={{ width: hourWidth, height: ROW_H }}
                >
                  <span className="text-[11px] font-bold text-faint">{fmt(h)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── crew rows ── */}
          {rows.map((row) => {
            const clashIds = getClashIds(row.shifts);
            const resolvedColor = (shift: SchedulerShift): AvatarHue =>
              shift.color ?? avatarHue(row.name);

            return (
              <div key={row.id} className="flex border-b border-line last:border-b-0">
                {/* sticky name column */}
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-card px-3 border-r border-line"
                  style={{ width: NAME_COL, height: ROW_H }}
                >
                  <PersonAvatar name={row.name} src={row.src} className="size-7 shrink-0" />
                  <span className="text-[13.5px] font-medium text-ink truncate min-w-0">
                    {row.name}
                  </span>
                </div>

                {/* track lane */}
                <div className="relative" style={{ width: trackW, height: ROW_H }}>
                  {/* hour gridlines */}
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 border-r border-line"
                      style={{ left: (h - startHour) * hourWidth }}
                      aria-hidden="true"
                    />
                  ))}

                  {/* shift bars */}
                  {row.shifts.map((shift) => {
                    const isClash = clashIds.has(shift.id);
                    const hue = resolvedColor(shift);
                    const left = Math.max(0, (shift.startHour - startHour) * hourWidth);
                    const width = Math.max(
                      hourWidth * 0.25,
                      (shift.endHour - shift.startHour) * hourWidth - 4,
                    );

                    return (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => onShiftClick?.(shift, row)}
                        className={cn(
                          "absolute flex items-center overflow-hidden rounded-[8px] px-2",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                          "motion-safe:transition-[opacity,transform] hover:opacity-90 active:scale-[.98]",
                          "disabled:cursor-not-allowed disabled:opacity-45",
                          shift.isOpen
                            ? "border-2 border-dashed border-muted bg-transparent text-muted"
                            : isClash
                              ? "border-2 border-t-out bg-[var(--out-soft)]" /* TODO: use bg-out-soft once --color-out-soft added to @theme inline */
                              : cn(HUE_BG[hue], ON_FILL[hue]),
                          !shift.isOpen && isClash && "text-t-out",
                        )}
                        style={{
                          left: left + 2,
                          width,
                          top: BAR_INSET,
                          bottom: BAR_INSET,
                        }}
                        aria-label={`${row.name}: ${shift.label} ${fmt(shift.startHour)}–${fmt(shift.endHour)}${isClash ? " (clash)" : ""}`}
                      >
                        <span className="text-[12px] font-medium leading-none truncate">
                          {shift.label}
                        </span>
                        {isClash && (
                          <X className="ml-auto size-4 shrink-0 text-t-out" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}

export { CrewScheduler };
