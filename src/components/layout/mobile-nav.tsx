"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Warehouse,
  HardHat,
  Package,
  type LucideIcon,
} from "lucide-react";
import { cn, focusRing } from "@/lib/utils";

// A pending Link navigation triggered by a fast second tap on another bottom-nav
// item can resolve after the second one has already landed, snapping the user
// back to the first tab (Next.js App Router soft-navigation race — see
// vercel/next.js#83386, worse on mobile's higher latency). Single-flight guard:
// ignore taps while a nav-triggered transition to a DIFFERENT tab is still in
// flight; a 1.5s safety-valve timeout clears it if a navigation stalls so the
// bar never gets stuck.
const PENDING_NAV_TIMEOUT_MS = 1500;

// DESIGN.md §16 — mobile bottom nav is the 5 daily-operator workflows:
// Dashboard / Jobs / Warehouse / Crew / Assets. Settings lives in the
// avatar menu; everything else (Test & Tag, Maintenance, Clients, Suppliers,
// Locations, Activity) is sidebar-only on larger screens.
interface MobileNavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Match this path prefix for the active state (defaults to href). */
  matchPrefix?: string;
}

const navItems: MobileNavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/projects", icon: FolderOpen, label: "Jobs" },
  { href: "/warehouse", icon: Warehouse, label: "Warehouse" },
  { href: "/crew", icon: HardHat, label: "Crew" },
  { href: "/assets/registry", icon: Package, label: "Assets", matchPrefix: "/assets" },
];

/** See PENDING_NAV_TIMEOUT_MS above for why this exists. */
function useSingleFlightNavClick(pathname: string) {
  const router = useRouter();
  const pendingHrefRef = useRef<string | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleared whenever pathname changes (the in-flight navigation landed) or the
  // safety-valve timeout fires.
  useEffect(() => {
    pendingHrefRef.current = null;
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    };
  }, []);

  return useCallback(
    (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Let modified clicks (open in new tab, etc.) behave natively.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();

      // A tap on the currently-pending destination (impatient double-tap) or on
      // the current tab is a no-op either way.
      if (pendingHrefRef.current === href || pathname === href) return;
      // A tap on a DIFFERENT tab while one navigation is already in flight is the
      // race precondition — ignore it and let the in-flight one land.
      if (pendingHrefRef.current) return;

      pendingHrefRef.current = href;
      pendingTimeoutRef.current = setTimeout(() => {
        pendingHrefRef.current = null;
        pendingTimeoutRef.current = null;
      }, PENDING_NAV_TIMEOUT_MS);
      router.push(href);
    },
    [router, pathname]
  );
}

/**
 * Mobile bottom navigation bar (< md).
 * Rendered in the layout flow (not fixed) — the parent app-shell is a flex
 * column with overflow hidden, so this nav naturally sits at the bottom.
 * DESIGN.md §16: 56px tall, 22px icons, 11px labels, no badges.
 */
export function MobileNav() {
  const pathname = usePathname();
  const handleClick = useSingleFlightNavClick(pathname);

  return (
    <nav
      className="shrink-0 border-t border-line bg-paper md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-stretch justify-around px-1">
        {navItems.map((item) => {
          const isActive = item.matchPrefix
            ? pathname.startsWith(item.matchPrefix)
            : pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <a
              key={item.href}
              href={item.href}
              onClick={handleClick(item.href)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[var(--r)] transition-colors",
                focusRing,
                isActive ? "text-red" : "text-faint hover:text-ink-2",
              )}
            >
              <item.icon className="size-[22px]" aria-hidden />
              <span className="text-[11px] font-medium leading-none">{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
