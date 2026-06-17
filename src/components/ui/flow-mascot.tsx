import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * "Flow" — a moving-head stage light with googly eyes (DESIGN.md §11). The helpful roadie.
 * This is the CONCEPT idle pose; the full expression set (scanning / celebrating / worried)
 * awaits an illustrator pass (§18.1) — don't fabricate new poses. Use on empty states,
 * loading, 404, success. Decorative → aria-hidden unless it carries meaning.
 */
const FlowMascot = React.forwardRef<
  SVGSVGElement,
  React.SVGProps<SVGSVGElement> & { eyeColor?: string }
>(({ className, eyeColor = "var(--blue)", ...props }, ref) => (
  <svg
    ref={ref}
    viewBox="0 0 48 48"
    fill="none"
    className={cn("size-12 text-muted", className)}
    aria-hidden
    {...props}
  >
    {/* base + yoke + head — inherit currentColor so it tints with text-* */}
    <g fill="currentColor">
      <rect x="11" y="27" width="26" height="7" rx="2" />
      <rect x="16" y="34" width="16" height="5" rx="1.5" />
      <rect x="16" y="9" width="16" height="17" rx="6" />
    </g>
    {/* googly eyes */}
    <circle cx="20.5" cy="17" r="2.7" fill={eyeColor} />
    <circle cx="27.5" cy="17" r="2.7" fill={eyeColor} />
    <circle cx="21.4" cy="16.1" r="0.9" fill="var(--cream)" />
    <circle cx="28.4" cy="16.1" r="0.9" fill="var(--cream)" />
    {/* faint beam lines */}
    <path
      d="M14 26l-4-5M34 26l4-5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      opacity=".5"
    />
  </svg>
));
FlowMascot.displayName = "FlowMascot";

export { FlowMascot };
