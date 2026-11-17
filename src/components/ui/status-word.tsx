import type * as React from "react";
import { intentStyles, getStatusIntent } from "@/lib/status-colors";
import { GEAR_STAGE_LABELS, type GearStageKey } from "@/lib/vocabulary";
import type { StatusValue } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/**
 * A dot and a word, never a filled pill (UX unification D91, DESIGN.md
 * "Status Indicators"). Colour comes ONLY from `intentStyles`; nothing here
 * (or in any caller) maps a stage to a class. Closed is a neutral OUTLINE dot
 * (D2). The word is always rendered, so status is never colour-only.
 */
export function StatusWord({
  status,
  className,
  ...props
}: {
  status: StatusValue;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const styles = intentStyles[status.intent];
  return (
    <span
      {...props}
      data-intent={status.intent}
      data-outline={status.outline ? "true" : undefined}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-table-cell font-medium", className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-[7px] shrink-0 rounded-full",
          status.outline ? "border border-rep bg-transparent" : styles.dot,
        )}
      />
      <span className={cn(status.outline ? "text-muted" : styles.text)}>{status.label}</span>
    </span>
  );
}

/** A gear stage as a `StatusValue`: words from vocabulary.ts, intent from `gearStage`. */
export function gearStageValue(stage: GearStageKey): StatusValue {
  return {
    label: GEAR_STAGE_LABELS[stage],
    intent: getStatusIntent("gearStage", stage),
    ...(stage === "closed" ? { outline: true } : {}),
  };
}
