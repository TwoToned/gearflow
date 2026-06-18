import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * SectionHeader — overline chip + extending rule line for separating content zones.
 * The "EQUIPMENT ————" pattern from DESIGN.md; sits above a content group in a page.
 *
 * variant="default"   — 11px bold mono ALL-CAPS label + --line-2 rule (calm, data sections)
 * variant="prominent" — 15px Kalam red label + --line-2 rule (eyebrow/section kicker)
 *
 * DESIGN.md §5.5 (caption/meta 12px · badge 11px floor) · §7 (--line-2 hairline).
 */

export interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /** "default" = muted mono ALL-CAPS (data sections); "prominent" = Kalam red (eyebrow kicker). */
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
