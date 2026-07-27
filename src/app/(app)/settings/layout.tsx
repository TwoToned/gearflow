"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  CreditCard,
  Package,
  ShieldCheck,
  Palette,
  Users,
  Truck,
  CalendarSync,
  MonitorPlay,
  Shield,
  ShoppingCart,
  ClipboardCheck,
  Bookmark,
  SlidersHorizontal,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SettingsPermission =
  | "orgSettings"
  | "orgMembers"
  | "checkItem"
  | "project"
  | "invoice";

interface SettingsNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permission: SettingsPermission;
}

interface SettingsNavSection {
  label: string;
  items: SettingsNavItem[];
}

// Grouped settings IA — 4 sections with overline labels (DESIGN.md §5.2 sentence-case
// section labels). Section labels read as wayfinding, not shouting.
const settingsNav: SettingsNavSection[] = [
  {
    label: "Organization",
    items: [
      { title: "General", href: "/settings", icon: Building2, permission: "orgSettings" },
      { title: "Billing", href: "/settings/billing", icon: CreditCard, permission: "orgSettings" },
      { title: "Branding & documents", href: "/settings/branding", icon: Palette, permission: "orgSettings" },
      { title: "Team", href: "/settings/team", icon: Users, permission: "orgMembers" },
      { title: "Single Sign-On", href: "/settings/sso", icon: Shield, permission: "orgSettings" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Assets", href: "/settings/assets", icon: Package, permission: "orgSettings" },
      { title: "Custom Fields", href: "/settings/custom-fields", icon: SlidersHorizontal, permission: "orgSettings" },
      { title: "Test & Tag", href: "/settings/test-and-tag", icon: ShieldCheck, permission: "orgSettings" },
      { title: "Check Items", href: "/settings/check-items", icon: ClipboardCheck, permission: "checkItem" },
      { title: "Group Templates", href: "/settings/group-templates", icon: Bookmark, permission: "project" },
      { title: "Services", href: "/settings/services", icon: Truck, permission: "orgSettings" },
    ],
  },
  {
    label: "Documents",
    items: [
      { title: "Calendars", href: "/settings/calendars", icon: CalendarSync, permission: "orgSettings" },
      { title: "Displays", href: "/settings/displays", icon: MonitorPlay, permission: "orgSettings" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { title: "WooCommerce", href: "/settings/woocommerce", icon: ShoppingCart, permission: "orgSettings" },
      // WS1 (#940) — xero_manage (not orgSettings) gates this: connecting/
      // disconnecting Xero and editing coding defaults is a more sensitive
      // action than most org settings, restricted to owner/admin by default.
      { title: "Xero", href: "/settings/xero", icon: Landmark, permission: "invoice" },
    ],
  },
];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const canReadSettings = useCanDo("orgSettings", "read");
  const canReadMembers = useCanDo("orgMembers", "read");
  const canReadCheckItems = useCanDo("checkItem", "read");
  const canManageLineItems = useCanDo("project", "manage_line_items");
  const canManageXero = useCanDo("invoice", "xero_manage");
  const { data: activeOrg } = useActiveOrganization();

  if (!canReadSettings && !canReadMembers) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="t-title text-ink">Access denied</h2>
        <p className="mt-2 t-body text-muted">
          You don&apos;t have permission to access settings.
        </p>
      </div>
    );
  }

  const hasPermission = (permission: SettingsPermission): boolean => {
    if (permission === "orgSettings") return canReadSettings;
    if (permission === "orgMembers") return canReadMembers;
    if (permission === "checkItem") return canReadCheckItems;
    if (permission === "project") return canManageLineItems;
    if (permission === "invoice") return canManageXero;
    return true;
  };

  const orgInitial = activeOrg?.name?.charAt(0)?.toUpperCase() ?? "O";

  // Active-state logic: longest prefix match wins, with "/settings" only active when exact.
  const allLinks = settingsNav.flatMap((s) => s.items.map((i) => i.href));
  const activeHref = (() => {
    const matches = allLinks
      .filter((href) => pathname === href || (href !== "/settings" && pathname.startsWith(href + "/")))
      .sort((a, b) => b.length - a.length);
    if (matches.length > 0) return matches[0];
    return pathname === "/settings" ? "/settings" : null;
  })();

  const activeItem = settingsNav.flatMap((s) => s.items).find((i) => i.href === activeHref);
  const activeTitle = activeItem?.title ?? "Settings";

  // Visible sections (after permission filtering) — shared by the desktop rail and the
  // mobile jump-to select so they never drift.
  const visibleSections = settingsNav
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasPermission(item.permission)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Dynamic header — espresso org monogram (DESIGN.md nav §) + active page + org name */}
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-[var(--r)] bg-paper-2 text-base font-bold text-red shadow-[var(--sh-card)]">
          {orgInitial}
        </div>
        <div className="min-w-0">
          <h1 className="t-title text-ink truncate">{activeTitle}</h1>
          <p className="t-small text-muted truncate">{activeOrg?.name ?? "Organization"}</p>
        </div>
      </div>

      {/* Mobile: a jump-to select beats the old horizontal scroll for discoverability */}
      <div className="md:hidden">
        <Select value={activeHref ?? undefined} onValueChange={(href) => router.push(href)}>
          <SelectTrigger aria-label="Jump to settings section">
            <SelectValue placeholder="Go to…">
              <span className="flex items-center gap-2">
                {activeItem ? <activeItem.icon className="size-4 text-muted" /> : null}
                {activeTitle}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {visibleSections.map((section) => (
              <SelectGroup key={section.label}>
                <SelectLabel className="t-overline text-faint">{section.label}</SelectLabel>
                {section.items.map((item) => (
                  <SelectItem key={item.href} value={item.href}>
                    <span className="flex items-center gap-2">
                      <item.icon className="size-4 text-muted" />
                      {item.title}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        {/* Desktop settings rail — grouped, sentence-case overlines, sidebar active grammar */}
        <nav className="hidden shrink-0 md:block md:w-56">
          <div className="space-y-5">
            {visibleSections.map((section) => (
              <div key={section.label} className="space-y-1">
                <div className="t-overline px-2.5 text-faint">{section.label}</div>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const isActive = activeHref === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 text-[14px] font-medium transition-colors",
                          FOCUS,
                          isActive
                            ? "bg-red-soft text-red shadow-[var(--sh-card)]"
                            : "text-ink-2 hover:bg-elev hover:text-ink",
                        )}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Page content */}
        <div className="min-w-0 flex-1 md:max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
