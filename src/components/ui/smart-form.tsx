"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * SmartFormLayout — the approved "smart form" scaffold extracted from
 * `asset-form.tsx`. A two-column grid: the form on the left and a sticky helper
 * rail on the right (hidden below `lg`). The rail content (Kalam tip + a live
 * preview card) is entity-specific and supplied per form via the `aside` slot.
 *
 * The shell is intentionally minimal: it owns the grid, the left-hand card
 * surface, and the sticky rail container. Sections, fields, validation, and the
 * preview card live in each form.
 */

interface SmartFormLayoutProps extends React.ComponentProps<"form"> {
  /** Helper-rail content (contextual tip + live preview card). */
  aside: React.ReactNode;
  /** Form sections + footer actions. */
  children: React.ReactNode;
}

export function SmartFormLayout({
  aside,
  children,
  className,
  ...formProps
}: SmartFormLayoutProps) {
  return (
    <form
      {...formProps}
      className={cn("grid gap-6 lg:grid-cols-[1fr_300px]", className)}
    >
      {/* Main form column */}
      <div className="rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        {children}
      </div>

      {/* Helper rail */}
      <aside className="hidden lg:block">
        <div className="sticky top-4 space-y-4 rounded-[var(--r-lg)] border border-line bg-paper-2/50 p-4">
          {aside}
        </div>
      </aside>
    </form>
  );
}

/**
 * SmartFormRail — the standard helper-rail header: an overline eyebrow plus a
 * Kalam contextual tip. Pair with a `SmartFormPreview` block beneath it.
 */
export function SmartFormRail({
  eyebrow,
  tip,
}: {
  eyebrow: string;
  tip: string;
}) {
  return (
    <div>
      <p className="t-overline text-faint">{eyebrow}</p>
      <p className="mt-1 font-hand text-[15px] text-t-out">{tip}</p>
    </div>
  );
}

/**
 * SmartFormPreview — the "Preview" labelled container in the rail. Wrap the
 * entity-specific live preview card in this for a consistent overline + divider.
 */
export function SmartFormPreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="t-overline text-faint">Preview</p>
      {children}
    </div>
  );
}

/**
 * SmartFormSection — a flat form section with a title + optional hint. Mirrors
 * the asset-form section pattern: first section flush, the rest divided by a
 * `border-t`. Per DESIGN.md forms are flat (no per-section card wrapping).
 */
export function SmartFormSection({
  title,
  hint,
  children,
  divider = true,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  /** Top divider + spacing. Set false for the first section. */
  divider?: boolean;
}) {
  return (
    <section className={cn("space-y-5", divider && "border-t border-line pt-6")}>
      <div>
        <h2 className="text-card-title font-bold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 t-micro text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * SmartFormField — label + control + hint/error. Error text uses `text-t-out`
 * with no personality copy (DESIGN §9).
 */
export function SmartFormField({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-red"> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="t-micro text-muted">{hint}</p>}
      {error && <p className="t-micro text-t-out">{error}</p>}
    </div>
  );
}
