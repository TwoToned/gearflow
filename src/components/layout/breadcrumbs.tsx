"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { buildTrail, type Crumb } from "@/lib/breadcrumbs";
import { NavLink } from "@/components/layout/nav-link";
import { NAV_FOCUS } from "@/components/layout/nav-tone";

interface BreadcrumbCtx {
  entityLabel: string | undefined;
  setEntityLabel: (label: string | undefined) => void;
}

const BreadcrumbContext = createContext<BreadcrumbCtx | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [entityLabel, setEntityLabel] = useState<string | undefined>(undefined);
  const value = useMemo(() => ({ entityLabel, setEntityLabel }), [entityLabel]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * A detail page names its record for the trail: `useBreadcrumbs("#2341 Hilton gala")`.
 * `undefined` (still loading) shows nothing rather than a raw id; the label is
 * cleared when the page unmounts so the next page never inherits it.
 */
export function useBreadcrumbs(entityLabel: string | undefined): void {
  const ctx = useContext(BreadcrumbContext);
  const setLabel = ctx?.setEntityLabel;
  useEffect(() => {
    setLabel?.(entityLabel);
    return () => setLabel?.(undefined);
  }, [entityLabel, setLabel]);
}

/** The current trail (route segments from NAV + the page's entity label). */
export function useTrail(): Crumb[] {
  const pathname = usePathname();
  const ctx = useContext(BreadcrumbContext);
  return useMemo(() => buildTrail(pathname, ctx?.entityLabel), [pathname, ctx?.entityLabel]);
}

/** `Jobs › #2341 Hilton › Equipment` — each segment a link, the last one ink. */
export function Breadcrumbs({ trail, className }: { trail: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
        {trail.map((c, i) => (
          <li key={`${i}-${c.label}`} className={cn("flex min-w-0 items-center gap-1.5", i === trail.length - 1 && "min-w-0 flex-1")}>
            {c.href ? (
              <NavLink href={c.href} className={cn("max-w-[180px] truncate rounded-sm transition-colors hover:text-ink", NAV_FOCUS)}>
                {c.label}
              </NavLink>
            ) : (
              <span aria-current="page" className="truncate font-medium text-ink">
                {c.label}
              </span>
            )}
            {i < trail.length - 1 && <span aria-hidden className="text-muted/60">›</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
