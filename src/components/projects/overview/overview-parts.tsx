"use client";

import * as React from "react";
import Link from "next/link";
import { cn, focusRing } from "@/lib/utils";

/**
 * The calm Overview's furniture (spec §6b, UX Phase 7): hairline sections,
 * sentence-case overlines (DESIGN §5.2, `t-overline`), quiet lines and text
 * links. No cards, no tiles, no per-row buttons. Shared by every Overview
 * section so the columns line up and read as one page, not five widgets.
 */

export function OverviewSection({ className, children, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("border-t border-line py-5 first:border-t-0 first:pt-2", className)} {...rest}>
      {children}
    </section>
  );
}

export function OverviewLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="t-overline mb-2 text-muted">{children}</h3>;
}

/** One line of fact. `muted` for the secondary lines under it. */
export function OverviewLine({ muted, className, children }: { muted?: boolean; className?: string; children: React.ReactNode }) {
  return <p className={cn("text-table-cell leading-relaxed", muted ? "text-muted" : "text-ink", className)}>{children}</p>;
}

/** A row of text links: 44px tall tap targets on a phone (inline links inside a sentence stay inline). */
export function OverviewLinks({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 max-md:[&>*]:min-h-11">{children}</div>;
}

// `tap-area` (globals.css): a 44px hit box on a phone without changing the line.
const LINK = "tap-area inline-flex items-center gap-1 rounded-sm text-caption font-semibold text-link hover:underline";

/** A text link that does something on this page (opens a dialog, a tab). */
export const OverviewTextButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  function OverviewTextButton({ className, type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={cn(LINK, focusRing, className)} {...rest} />;
  },
);

/** A text link that navigates (client-side for an in-app path). */
export function OverviewTextLink({ className, href, ...rest }: Omit<React.ComponentProps<"a">, "href"> & { href: string }) {
  return <Link href={href} className={cn(LINK, focusRing, className)} {...rest} />;
}
