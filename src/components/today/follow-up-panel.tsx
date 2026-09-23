"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, PhoneMissed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TodayItem } from "./today-types";

interface FollowUpPanelProps {
  item: TodayItem;
  canEdit: boolean;
  onOutcome?: (item: TodayItem, outcome: "no_reply" | "parked", nextDate?: string) => void;
}

/**
 * What an automated follow-up is for and what you can do about it
 * (follow-up automation design §8.3/§8.7). Three exits, one per real outcome:
 *  - no reply → the engine schedules the next rung (or the decision);
 *  - park until a date → the client said "come back in March";
 *  - won / lost → recorded on the quote itself (accept/decline, which close
 *    this row), so the link opens the job's Finance tab rather than offering
 *    a second, weaker way to accept a quote.
 */
export function FollowUpPanel({ item, canEdit, onOutcome }: FollowUpPanelProps) {
  const [parking, setParking] = useState(false);
  const [until, setUntil] = useState("");
  const followUp = item.followUp;
  if (!followUp) return null;
  const financeHref = item.href ? `${item.href}?tab=finance` : undefined;
  const canAct = canEdit && !!onOutcome && !item.done;

  return (
    <div className="space-y-3 rounded-[var(--r)] border border-line bg-elev px-3 py-3">
      <p className="text-caption text-muted">{followUp.why}</p>
      {canAct && (
        <div className="flex flex-wrap gap-2">
          <Button variant="line" size="sm" onClick={() => onOutcome(item, "no_reply")}>
            <PhoneMissed className="h-4 w-4" /> No reply yet
          </Button>
          <Button variant="line" size="sm" onClick={() => setParking((p) => !p)} aria-expanded={parking}>
            <CalendarClock className="h-4 w-4" /> Park until…
          </Button>
          {financeHref && (
            <Button asChild variant="line" size="sm">
              <Link href={financeHref}>
                <ExternalLink className="h-4 w-4" /> Won or lost
              </Link>
            </Button>
          )}
        </div>
      )}
      {canAct && parking && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (until) onOutcome(item, "parked", until);
          }}
        >
          <Input
            type="date"
            aria-label="Come back to it on"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="h-8 w-auto"
          />
          <Button type="submit" size="sm" disabled={!until}>
            Park
          </Button>
        </form>
      )}
    </div>
  );
}
