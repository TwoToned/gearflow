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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";

const settingsNav = [
  { title: "General", href: "/settings", icon: Building2, permission: "orgSettings" as const },
  { title: "Billing", href: "/settings/billing", icon: CreditCard, permission: "orgSettings" as const },
  { title: "Assets", href: "/settings/assets", icon: Package, permission: "orgSettings" as const },
  { title: "Test & Tag", href: "/settings/test-and-tag", icon: ShieldCheck, permission: "orgSettings" as const },
  { title: "Services", href: "/settings/services", icon: Truck, permission: "orgSettings" as const },
  { title: "Documents", href: "/settings/documents", icon: FileText, permission: "document" as const },
  { title: "Branding", href: "/settings/branding", icon: Palette, permission: "orgSettings" as const },
  { title: "Calendars", href: "/settings/calendars", icon: CalendarSync, permission: "orgSettings" as const },
  { title: "Check Items", href: "/settings/check-items", icon: ClipboardCheck, permission: "checkItem" as const },
  { title: "Displays", href: "/settings/displays", icon: MonitorPlay, permission: "orgSettings" as const },
  { title: "Team", href: "/settings/team", icon: Users, permission: "orgMembers" as const },
  { title: "WooCommerce", href: "/settings/woocommerce", icon: ShoppingCart, permission: "orgSettings" as const },
  { title: "Single Sign-On", href: "/settings/sso", icon: Shield, permission: "orgSettings" as const },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const canReadSettings = useCanDo("orgSettings", "read");
  const canReadMembers = useCanDo("orgMembers", "read");
  const canManageTemplates = useCanDo("document", "manage_templates");
  const canReadCheckItems = useCanDo("checkItem", "read");
  const { data: activeOrg } = useActiveOrganization();

  if (!canReadSettings && !canReadMembers) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="mt-2 text-sm text-fg-3">
          You don&apos;t have permission to access settings.
        </p>
      </div>
    );
  }

  const visibleNav = settingsNav.filter((item) => {
    if (item.permission === "orgSettings") return canReadSettings;
    if (item.permission === "orgMembers") return canReadMembers;
    if (item.permission === "document") return canManageTemplates;
    if (item.permission === "checkItem") return canReadCheckItems;
    return true;
  });

  const orgInitial = activeOrg?.name?.charAt(0)?.toUpperCase() ?? "O";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {orgInitial}
        </div>
        <div>
          <h1 className="t-title text-fg">Settings</h1>
          <p className="text-[13px] text-fg-3">
            {activeOrg?.name ?? "Organization"}
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Settings nav */}
        <nav className="flex md:flex-col gap-1 md:w-48 shrink-0 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
          {visibleNav.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/settings" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap",
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
        </nav>

        {/* Page content */}
        <div className="flex-1 max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
