"use client";
// use-client: the save bar is interactive (R-8.1.1)

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A flat form section: title + helper on the left, fields on the right (Dub/Stripe grammar). */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-8 gap-y-4 p-5 sm:p-6 md:grid-cols-[minmax(0,200px)_1fr]">
      <div className="md:pt-0.5">
        <h2 className="t-heading text-ink">{title}</h2>
        <p className="mt-1 t-micro text-muted">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** The hairline card that stacks `SettingsSection`s. */
export function SettingsSections({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]">
      {children}
    </div>
  );
}

/** The sticky dirty bar (Vapi grammar): Reset / Save, visible only while there are unsaved changes. */
export function SettingsSaveBar({
  isDirty,
  pending,
  saveLabel = "Save changes",
  onReset,
  onSave,
}: {
  isDirty: boolean;
  pending: boolean;
  saveLabel?: string;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10">
      <div
        className={cn(
          "flex items-center justify-between gap-4 rounded-[var(--r)] border border-line bg-paper-2/95 px-4 py-3 shadow-[var(--sh-card)] backdrop-blur transition-opacity",
          isDirty ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!isDirty}
      >
        <p className="t-small text-ink-2">You have unsaved changes.</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="line" size="sm" onClick={onReset} disabled={pending}>
            Reset
          </Button>
          <Button type="button" size="sm" onClick={onSave} loading={pending} disabled={pending}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
