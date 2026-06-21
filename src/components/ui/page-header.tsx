import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PageHeader — title + description + actions for the top of every list/detail page.
 * Unifies the ad-hoc header built on ~40 pages. DESIGN.md §5.5:
 *   - title: 24px display 800, tracking -.02em (app page-title ramp)
 *   - description: 14px body 400, --muted
 *   - eyebrow: Kalam 13px red (optional module/stage label above the title)
 *   - actions slot: Button(s), right-aligned, flex-row with gap-2
 * Border rule: 1px --line hairline under the block (§7 inner rows).
 */

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  /** Kalam eyebrow above the title — e.g. module name, stage, or section label. */
  eyebrow?: string;
  /** Button(s) rendered flush-right at all breakpoints. */
  actions?: React.ReactNode;
}

function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 pb-5 border-b border-line",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col">
        {eyebrow && (
          <p className="font-hand text-[16px] font-bold text-red leading-none mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display font-extrabold text-[24px] leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 font-sans text-[14px] leading-snug text-muted">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>
      )}
    </div>
  );
}

export { PageHeader };
