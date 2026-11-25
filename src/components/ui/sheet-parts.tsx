"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The parts every form sheet body is made of (UX Phase 12, §9l.3): a bold section word
 * with a muted hint line, a field with its label and an inline error under it, and a
 * `More details` section that is collapsed on create and open on edit. Presentational;
 * the sheet owns the form state and the validation.
 */
export function SheetSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-card-title font-bold text-ink">{title}</h3>
        {hint ? <p className="mt-0.5 text-caption text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function SheetField({
  label,
  required,
  hint,
  error,
  className,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  /** The `id` of the control inside, so the label names it (clicking the label focuses it). */
  htmlFor?: string;
  hint?: string;
  /** Shown under the field as soon as it is set; the field is marked invalid for assistive tech. */
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-red-text"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-caption text-t-out">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function SheetMore({ defaultOpen, label = "More details", children }: { defaultOpen?: boolean; label?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <section className="border-t border-line pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-1.5 text-left text-card-title font-bold text-ink"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        {label}
      </button>
      {open ? <div className="space-y-4 pt-2">{children}</div> : null}
    </section>
  );
}
