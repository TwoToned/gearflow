"use client";
// use-client: interactive — Radix Switch + controlled number inputs (R-8.1.1)

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrgFollowUpSettings } from "@/lib/org-settings-types";
import { FOLLOW_UP_BOUNDS, FOLLOW_UP_DEFAULTS } from "../../../convex/lib/followUpRules";

/**
 * Follow-up automation settings (FEATUREDOCS/82): the two loop switches and the
 * three offsets. Same "sentence, not a bare toggle" grammar as
 * `StatusAutomationSettings` / `CrewTimeSettingsPanel`, and the same storage
 * rule: absent = the engine default (`FOLLOW_UP_DEFAULTS`, loops ON), so
 * returning a field to its default deletes the key.
 */
type SwitchKey = "quotesEnabled" | "invoicesEnabled";
type OffsetKey = keyof typeof FOLLOW_UP_DEFAULTS;

const SWITCHES: { key: SwitchKey; title: string; detail: string }[] = [
  {
    key: "quotesEnabled",
    title: "Quote follow-ups",
    detail:
      "When a quote goes out, the job's manager gets a follow-up task. Each \"No reply yet\" schedules the next one; the third asks for a decision, always before the event.",
  },
  {
    key: "invoicesEnabled",
    title: "Invoice chasing",
    detail:
      "An invoice past its due date and not paid gets a chase task, then a call, then a decision. A job that came back with no invoice gets a \"Raise the invoice\" task. Payments are read from Xero when it's connected; otherwise only payments recorded in Flow count.",
  },
];

const OFFSETS: { key: OffsetKey; label: string; detail: string; unit: string; bounds: { min: number; max: number } }[] = [
  {
    key: "firstFollowUpBusinessDays",
    label: "First follow-up",
    detail: "Business days after a quote is sent.",
    unit: "business days",
    bounds: FOLLOW_UP_BOUNDS.businessDays,
  },
  {
    key: "nextFollowUpBusinessDays",
    label: "Next follow-up",
    detail: "Business days after each \"No reply yet\" on a quote.",
    unit: "business days",
    bounds: FOLLOW_UP_BOUNDS.businessDays,
  },
  {
    key: "decisionLeadDays",
    label: "Decide by",
    detail: "Days before the event a quiet quote must be decided, so held gear is released in time.",
    unit: "days before",
    bounds: FOLLOW_UP_BOUNDS.decisionLeadDays,
  },
];

export function FollowUpSettingsPanel({
  value,
  disabled,
  onChange,
}: {
  value: OrgFollowUpSettings | undefined;
  disabled?: boolean;
  onChange: (next: OrgFollowUpSettings) => void;
}) {
  function setSwitch(key: SwitchKey, enabled: boolean) {
    const next = { ...value };
    if (enabled) delete next[key];
    else next[key] = false;
    onChange(next);
  }

  function setOffset(key: OffsetKey, raw: string) {
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed)) return;
    const next = { ...value };
    if (parsed === FOLLOW_UP_DEFAULTS[key]) delete next[key];
    else next[key] = parsed;
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-line rounded-[var(--radius)] border border-line">
        {SWITCHES.map((s) => (
          <div key={s.key} className="flex items-start justify-between gap-4 px-3 py-3">
            <div className="min-w-0">
              <p className="t-small font-medium text-ink">{s.title}</p>
              <p className="mt-0.5 t-micro text-muted">{s.detail}</p>
            </div>
            <Switch
              checked={value?.[s.key] !== false}
              disabled={disabled}
              onCheckedChange={(next) => setSwitch(s.key, next)}
              aria-label={s.title}
            />
          </div>
        ))}
      </div>

      <div className="divide-y divide-line rounded-[var(--radius)] border border-line">
        {OFFSETS.map((o) => {
          const id = `follow-up-${o.key}`;
          return (
            <div key={o.key} className="flex items-start justify-between gap-4 px-3 py-3">
              <div className="min-w-0">
                <Label htmlFor={id} className="t-small font-medium text-ink">
                  {o.label}
                </Label>
                <p className="mt-0.5 t-micro text-muted">{o.detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={o.bounds.min}
                  max={o.bounds.max}
                  className="w-20"
                  disabled={disabled}
                  value={value?.[o.key] ?? FOLLOW_UP_DEFAULTS[o.key]}
                  onChange={(e) => setOffset(o.key, e.target.value)}
                />
                <span className="t-micro text-muted">{o.unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
