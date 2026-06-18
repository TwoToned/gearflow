"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Warehouse,
  HardHat,
  Package,
  type LucideIcon,
} from "lucide-react";

// DESIGN.md §16 — mobile bottom nav is the 5 daily-operator workflows:
// Dashboard / Projects / Warehouse / Crew / Assets. Settings lives in the
// avatar menu; everything else (Test & Tag, Maintenance, Clients, Suppliers,
// Locations, Activity) is sidebar-only on larger screens.
//
// Scanning is NOT a bottom-nav tab — the Warehouse screen already owns the
// scan/lookup flow (warehouse/page.tsx), so it stays one screen away there
// rather than duplicating a shortcut here.
interface MobileNavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Match this path prefix for the active state (defaults to href). */
  matchPrefix?: string;
}

const navItems: MobileNavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/projects", icon: FolderOpen, label: "Projects" },
  { href: "/warehouse", icon: Warehouse, label: "Warehouse" },
  { href: "/crew", icon: HardHat, label: "Crew" },
  { href: "/assets/registry", icon: Package, label: "Assets", matchPrefix: "/assets" },
];

/**
 * Mobile bottom navigation bar (< md).
 * Rendered in the layout flow (not fixed) — the parent app-shell is a flex
 * column with overflow hidden, so this nav naturally sits at the bottom.
 * DESIGN.md §16: 56px tall, 22px icons, 11px labels, no badges.
 */
export function MobileNav() {
  const pathname = usePathname();

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
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex h-14 flex-1 flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? "text-red" : "text-faint hover:text-ink-2"
              }`}
            >
              <item.icon className="size-[22px]" aria-hidden />
              <span className="text-[11px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
