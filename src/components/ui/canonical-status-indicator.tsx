import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * StatusIndicator — compact dot / dot+glow / inline-label variants.
 * Use for tight spaces (table cells, row prefixes, card corners) where the full
 * Badge pill (§15.2) is too heavy.
 *
 * Intents map to the §3.3 status palette + a `live` variant for the real-time
 * "on-the-floor" pulsing dot (§15.4a / §15.5).
 *
 * MUST pair with a visible text label when used in isolation — colour alone is
 * never sufficient (§3.3 / §13). Use the `label` prop or ensure adjacent text.
 *
 * `glow` adds a soft ring around the dot using the status soft-fill token (§3.3).
 * Auto-enabled for `live`.
 */

const dotBase = cva("rounded-full shrink-0", {
  variants: {
    intent: {
      ok: "bg-ok",
      warn: "bg-warn",
      overbooked: "bg-t-out",
      repair: "bg-rep",
      neutral: "bg-muted",
      live: "bg-ok motion-safe:animate-pulse",
    },
    size: {
      sm: "size-1.5",
      default: "size-2",
      lg: "size-2.5",
    },
  },
  defaultVariants: { intent: "neutral", size: "default" },
});

// Soft ring-glow per intent using the §3.3 soft-fill tokens
const glowClass: Record<string, string> = {
  ok: "shadow-[0_0_0_4px_var(--ok-soft)]",
  warn: "shadow-[0_0_0_4px_var(--warn-soft)]",
  overbooked: "shadow-[0_0_0_4px_var(--out-soft)]",
  repair: "shadow-[0_0_0_4px_var(--rep-soft)]",
  neutral: "",
  live: "shadow-[0_0_0_4px_var(--ok-soft)]",
};

export interface StatusIndicatorProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof dotBase> {
  /** Soft ring-glow around the dot. Auto-enabled for `live`. */
  glow?: boolean;
  /**
   * Inline label rendered next to the dot. Recommended when the indicator is
   * used standalone — status must never be colour-only (§3.3).
   */
  label?: string;
}

function StatusIndicator({
  intent = "neutral",
  size,
  glow,
  label,
  className,
  ...props
}: StatusIndicatorProps) {
  const showGlow = glow ?? intent === "live";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    >
      <span
        className={cn(
          dotBase({ intent, size }),
          showGlow && glowClass[intent ?? "neutral"],
        )}
        aria-hidden="true"
      />
      {label && (
        <span className="text-[12px] font-sans font-medium text-muted">
          {label}
        </span>
      )}
    </span>
  );
}

export { StatusIndicator };
