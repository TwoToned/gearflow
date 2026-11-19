"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ScanLine } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import { bottomNavActive, type BottomNavKey } from "@/lib/nav";
import { useNavItems } from "@/hooks/use-nav-items";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { MoreSheet } from "@/components/layout/more-sheet";
import { ShellScan } from "@/components/scanner/shell-scan";

// A pending Link navigation triggered by a fast second tap on another bottom-nav
// item can resolve after the second one has already landed, snapping the user
// back to the first tab (Next.js App Router soft-navigation race — see
// vercel/next.js#83386, worse on mobile's higher latency). Single-flight guard:
// ignore taps while a nav-triggered transition to a DIFFERENT tab is still in
// flight; a 1.5s safety-valve timeout clears it if a navigation stalls so the
// bar never gets stuck.
const PENDING_NAV_TIMEOUT_MS = 1500;

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
const TAB = "flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[var(--r)] transition-colors";
const tone = (on: boolean) => (on ? "text-red" : "text-muted hover:text-ink-2");

function Tab({
  navKey, active, handleClick,
}: {
  navKey: BottomNavKey;
  active: boolean;
  handleClick: (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { byKey } = useNavItems();
  const item = byKey(navKey);
  if (!item) return null; // gated: absent, never greyed
  const Icon = NAV_ICONS[item.icon];
  return (
    <a
      href={item.url}
      onClick={handleClick(item.url)}
      aria-current={active ? "page" : undefined}
      className={cn(TAB, focusRing, tone(active))}
    >
      <Icon className="size-[22px]" aria-hidden />
      <span className="text-[11px] font-medium leading-none">{item.label}</span>
    </a>
  );
}

/** The raised 50 px red Scan circle (a button: it opens the camera from the tap, never navigates). */
function ScanTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Scan"
      className={cn("flex h-14 flex-1 flex-col items-center justify-start gap-0.5 rounded-[var(--r)] text-ink-2", focusRing)}
    >
      <span className="-mt-2 grid size-[50px] place-items-center rounded-full bg-red text-white shadow-[var(--lit)]">
        <ScanLine className="size-6" aria-hidden />
      </span>
      <span className="text-[11px] font-medium leading-none">Scan</span>
    </button>
  );
}

/**
 * Mobile bottom navigation bar (phone, <= 859px): Home · Jobs · Scan · Warehouse ·
 * More (D1/D65). Crew and Assets live in More (active there). Gated: a role without
 * warehouse loses Scan + Warehouse. The Scan circle is raised 8 px above the bar, so
 * the bar is `relative z-20` and not clipped.
 * Rendered in the layout flow (not fixed) — the parent app-shell is a flex
 * column with overflow hidden, so this nav naturally sits at the bottom.
 */
export function MobileNav() {
  const pathname = usePathname();
  const handleClick = useSingleFlightNavClick(pathname);
  const { byKey } = useNavItems();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const active = bottomNavActive(pathname);
  const canScan = !!byKey("warehouse");

  return (
    <nav
      aria-label="Primary"
      className="relative z-20 shrink-0 border-t border-line bg-paper md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-stretch justify-around px-1">
        <Tab navKey="home" active={active === "home"} handleClick={handleClick} />
        <Tab navKey="jobs" active={active === "jobs"} handleClick={handleClick} />
        {canScan && <ScanTab onOpen={() => setScanOpen(true)} />}
        <Tab navKey="warehouse" active={active === "warehouse"} handleClick={handleClick} />
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(TAB, focusRing, tone(active === "more"))}
          data-active={active === "more" ? "true" : undefined}
        >
          <NAV_ICONS.more className="size-[22px]" aria-hidden />
          <span className="text-[11px] font-medium leading-none">More</span>
        </button>
      </div>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
      <ShellScan open={scanOpen} onOpenChange={setScanOpen} />
    </nav>
  );
}
