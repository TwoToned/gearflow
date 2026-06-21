import * as React from "react";

/**
 * Compact RVLT "R" mark for the narrow nav rail (the full wordmark won't fit).
 * Reuses the R glyph from the wordmark, filled with brand red (var(--red)),
 * so it adapts across themes. Square-ish viewBox cropped to the R.
 */
export function RvltMark({
  className,
  title,
  ...props
}: React.SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 296 451"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="var(--red)"
        d="M0,42C0,21.94,16.92,5.64,36.98,5.64h106.56c82.12,0,137.91,58.92,137.91,131.64,0,60.18-37.61,101.55-81.49,112.21l-8.15.63,116.59,139.16c6.9,8.15,8.78,15.67,8.78,24.45,0,20.06-16.3,36.36-36.36,36.36-11.28,0-21.31-4.39-28.83-13.79l-146.68-174.26c-5.01-6.27-11.28-16.3-11.28-28.83,0-18.81,15.04-33.22,33.22-33.22h13.79c37.61,0,63.94-28.21,63.94-62.68s-26.33-63.31-63.94-63.31h-67.07v339.12c0,20.06-16.92,36.98-36.98,36.98S0,433.15,0,413.09V42Z"
      />
    </svg>
  );
}
