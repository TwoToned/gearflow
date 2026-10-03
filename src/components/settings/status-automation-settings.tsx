"use client";
// use-client: interactive — Radix Switch + controlled callbacks (R-8.1.1)

import { ArrowRight } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import {
  AUTO_STATUS_KEYS,
  AUTO_STATUS_LABELS,
  isAutoStatusEnabled,
  type AutoStatusKey,
  type ProjectStatusAutomationSettings,
} from "@/lib/project-status-automation";

/**
 * Status automation switches (#1160) — the org-level opt-outs for the four
 * moments a job advances its own status.
 *
 * Presented as a list of RULES, not a list of toggles: each row reads as the
 * sentence it encodes ("Quote sent → Quoted"), so the setting explains the
 * behaviour rather than assuming the reader already knows it. The arrow line is
 * the primary content and the switch is the trailing control, which is also why
 * the switch has no visible label of its own — the row title is its label
 * (`aria-label` carries the same sentence for screen readers, since an arrow
 * glyph doesn't read).
 *
 * Every switch ships ON and the stored value only ever records an opt-OUT, so a
 * row that has never been touched is indistinguishable from one explicitly left
 * on — which is the point: there is nothing to configure to get the good default.
 */
export function StatusAutomationSettings({
  value,
  disabled,
  onChange,
}: {
  value: ProjectStatusAutomationSettings | undefined;
  disabled?: boolean;
  onChange: (next: ProjectStatusAutomationSettings) => void;
}) {
  function setKey(key: AutoStatusKey, enabled: boolean) {
    const next: ProjectStatusAutomationSettings = { ...value };
    // Absent = on, so turning one back ON DELETES the key rather than storing
    // `true` — the blob keeps exactly one representation of the default.
    if (enabled) delete next[key];
    else next[key] = false;
    onChange(next);
  }

  return (
    <div className="divide-y divide-line rounded-[var(--radius)] border border-line">
      {AUTO_STATUS_KEYS.map((key) => {
        const label = AUTO_STATUS_LABELS[key];
        const enabled = isAutoStatusEnabled(value, key);
        return (
          <div key={key} className="flex items-start justify-between gap-4 px-3 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 t-small font-medium text-ink">
                {label.title}
                <ArrowRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                <span className="text-ink">{label.moves}</span>
              </p>
              <p className="mt-0.5 t-micro text-muted">{label.detail}</p>
            </div>
            <Switch
              checked={enabled}
              disabled={disabled}
              onCheckedChange={(next) => setKey(key, next)}
              aria-label={`${label.title} — move the job to ${label.moves}`}
            />
          </div>
        );
      })}
    </div>
  );
}
