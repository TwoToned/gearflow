import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionHeader — overline chip + extending rule line for separating content zones.
 * The "Equipment ————" pattern from DESIGN.md; sits above a content group in a page.
 *
 * variant="default"   — 11px bold sentence-case label (§5.2, never uppercase) + rule (calm, data sections)
 * variant="prominent" — 16px Kalam red label + rule (eyebrow/section kicker)
 *
 * DESIGN.md §5.2 (sentence case) · §7 (hairline rule).
 */

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /** "default" = muted sentence-case label (data sections); "prominent" = Kalam red (eyebrow kicker). */
  variant?: "default" | "prominent";
}

function SectionHeader({
  label,
  variant = "default",
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn("flex items-center gap-3", className)}
      {...props}
    >
      <span
        className={cn(
          "shrink-0 leading-none",
          variant === "prominent"
            ? "font-hand text-[16px] font-bold text-red"
            : "font-sans text-[11px] font-bold tracking-wide text-muted",
        )}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

export { SectionHeader };
