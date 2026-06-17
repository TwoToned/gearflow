"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarRange,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Package,
} from "lucide-react";

// Module wayfinding hues per DESIGN.md §15.5 (active tab stays red, §3.5).
const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home", tint: "text-ink-2" },
  { href: "/projects", icon: FolderOpen, label: "Jobs", tint: "text-blue" },
  { href: "/crew/planner", icon: CalendarRange, label: "Schedule", tint: "text-purple" },
  { href: "/assets/registry", icon: Package, label: "Gear", matchPrefix: "/assets", tint: "text-amber" },
  { href: "/quotes", icon: FileText, label: "Quotes", tint: "text-blue" },
];

/**
 * RVLT Flow mobile bottom navigation.
 * Five tabs max, fixed to the safe-area edge per DESIGN.md §15.5 / §16.7.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-line-2 bg-paper-2 px-1 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1 py-1">
        {navItems.map((item) => {
          const isActive = item.matchPrefix
            ? pathname.startsWith(item.matchPrefix)
            : pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-bold transition-colors ${
                isActive ? "bg-elev text-red shadow-[var(--lit)]" : "text-muted hover:text-ink"
              }`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "" : item.tint}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
