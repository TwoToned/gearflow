"use client";
// use-client: interactive — Radix Switch + a controlled number input (R-8.1.1)

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_UNANSWERED_OFFER_HOURS,
  UNANSWERED_OFFER_HOURS_BOUNDS,
} from "@/lib/crew-time-settings";
import type { CrewTimeSettings } from "@/lib/org-settings-types";

/**
 * Crew planner confirmation-layer settings (work-layer Phase 4, #1246,
 * design §8.5): the Triage "unanswered offer" threshold and the day-before
 * call-time reminder opt-in. Mirrors `StatusAutomationSettings`'s "sentence,
 * not a bare toggle" pattern — each row explains what it does.
 */
export function CrewTimeSettingsPanel({
  value,
  disabled,
  onChange,
}: {
  value: CrewTimeSettings | undefined;
  disabled?: boolean;
  onChange: (next: CrewTimeSettings) => void;
}) {
  const unansweredOfferHours = value?.unansweredOfferHours ?? DEFAULT_UNANSWERED_OFFER_HOURS;
  const callReminderEnabled = value?.callReminderEnabled === true;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-line px-3 py-3">
        <div className="min-w-0">
          <Label htmlFor="crew-time-unanswered-hours" className="t-small font-medium text-ink">
            Unanswered offer threshold
          </Label>
          <p className="mt-0.5 t-micro text-muted">
            A crew offer left unanswered this long shows up in the project manager&rsquo;s Triage,
            with one-key re-offer or find-cover.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            id="crew-time-unanswered-hours"
            type="number"
            inputMode="numeric"
            min={UNANSWERED_OFFER_HOURS_BOUNDS.min}
            max={UNANSWERED_OFFER_HOURS_BOUNDS.max}
            className="w-20"
            disabled={disabled}
            value={unansweredOfferHours}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (!Number.isFinite(parsed)) return;
              // Absent = the documented default, so resetting to it deletes the
              // key rather than storing it explicitly (one representation).
              const next = { ...value };
              if (parsed === DEFAULT_UNANSWERED_OFFER_HOURS) delete next.unansweredOfferHours;
              else next.unansweredOfferHours = parsed;
              onChange(next);
            }}
            aria-label="Unanswered offer threshold, in hours"
          />
          <span className="t-micro text-muted">hours</span>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-line px-3 py-3">
        <div className="min-w-0">
          <p className="t-small font-medium text-ink">Call-time reminders</p>
          <p className="mt-0.5 t-micro text-muted">
            Email crew the day before a confirmed shift with call time, location and PM phone.
            Off by default.
          </p>
        </div>
        <Switch
          checked={callReminderEnabled}
          disabled={disabled}
          onCheckedChange={(next) => {
            const updated = { ...value };
            // Off is the documented default — clear rather than store `false`,
            // so an untouched org has one representation of "disabled".
            if (next) updated.callReminderEnabled = true;
            else delete updated.callReminderEnabled;
            onChange(updated);
          }}
          aria-label="Email crew the day before a confirmed shift"
        />
      </div>
    </div>
  );
}
