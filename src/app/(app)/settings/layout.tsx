"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  FileText,
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
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";

type SettingsPermission =
  | "orgSettings"
  | "orgMembers"
  | "document"
  | "checkItem"
  | "project";

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

// Grouped settings IA — 4 sections with overline labels (DESIGN.md section labels pattern)
const settingsNav: SettingsNavSection[] = [
  {
    label: "ORGANIZATION",
    items: [
      { title: "General", href: "/settings", icon: Building2, permission: "orgSettings" },
      { title: "Billing", href: "/settings/billing", icon: CreditCard, permission: "orgSettings" },
      { title: "Branding", href: "/settings/branding", icon: Palette, permission: "orgSettings" },
      { title: "Team", href: "/settings/team", icon: Users, permission: "orgMembers" },
      { title: "Single Sign-On", href: "/settings/sso", icon: Shield, permission: "orgSettings" },
    ],
  },
  {
    label: "OPERATIONS",
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
    label: "DOCUMENTS",
    items: [
      { title: "Documents", href: "/settings/documents", icon: FileText, permission: "document" },
      { title: "Calendars", href: "/settings/calendars", icon: CalendarSync, permission: "orgSettings" },
      { title: "Displays", href: "/settings/displays", icon: MonitorPlay, permission: "orgSettings" },
    ],
  },
  {
    label: "INTEGRATIONS",
    items: [
      { title: "WooCommerce", href: "/settings/woocommerce", icon: ShoppingCart, permission: "orgSettings" },
      { title: "Discord", href: "/settings/discord", icon: MessageSquare, permission: "orgSettings" },
    ],
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const canReadSettings = useCanDo("orgSettings", "read");
  const canReadMembers = useCanDo("orgMembers", "read");
  const canManageTemplates = useCanDo("document", "manage_templates");
  const canReadCheckItems = useCanDo("checkItem", "read");
  const canManageLineItems = useCanDo("project", "manage_line_items");
  const { data: activeOrg } = useActiveOrganization();

  if (!canReadSettings && !canReadMembers) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="t-title">Access Denied</h2>
        <p className="mt-2 t-body text-fg-3">
          You don&apos;t have permission to access settings.
        </p>
      </div>
    );
  }

  const hasPermission = (permission: SettingsPermission): boolean => {
    if (permission === "orgSettings") return canReadSettings;
    if (permission === "orgMembers") return canReadMembers;
    if (permission === "document") return canManageTemplates;
    if (permission === "checkItem") return canReadCheckItems;
    if (permission === "project") return canManageLineItems;
    return true;
  };

  const orgInitial = activeOrg?.name?.charAt(0)?.toUpperCase() ?? "O";

  // Active-state logic: longest prefix match wins, with "/settings" only active when exact
  const allLinks = settingsNav.flatMap((s) => s.items.map((i) => i.href));
  const activeHref = (() => {
    const matches = allLinks
      .filter((href) => pathname === href || (href !== "/settings" && pathname.startsWith(href + "/")))
      .sort((a, b) => b.length - a.length);
    if (matches.length > 0) return matches[0];
    return pathname === "/settings" ? "/settings" : null;
  })();

  const activeTitle = settingsNav.flatMap((s) => s.items).find((i) => i.href === activeHref)?.title ?? "Settings";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {orgInitial}
        </div>
        <div>
          <h1 className="t-title text-fg">{activeTitle}</h1>
          <p className="t-body text-fg-3">
            {activeOrg?.name ?? "Organization"}
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Settings nav — grouped with overline section labels */}
        <nav className="md:w-52 shrink-0 md:overflow-x-visible overflow-x-auto pb-2 md:pb-0">
          <div className="flex md:flex-col gap-1 md:gap-0 md:space-y-4">
            {settingsNav.map((section) => {
              const visibleItems = section.items.filter((item) => hasPermission(item.permission));
              if (visibleItems.length === 0) return null;
              return (
                <div key={section.label} className="md:space-y-0.5">
                  <div className="hidden md:block t-overline text-fg-4 px-3 mb-1">
                    {section.label}
                  </div>
                  <div className="flex md:flex-col gap-1 md:gap-0.5">
                    {visibleItems.map((item) => {
                      const isActive = activeHref === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors whitespace-nowrap",
                            isActive
                              ? "bg-bg-elevated text-fg"
                              : "text-fg-2 hover:bg-bg-elevated/50 hover:text-fg"
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          {item.title}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        {/* Page content */}
        <div className="flex-1 max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
