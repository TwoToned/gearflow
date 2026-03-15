"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  Package,
  ShieldCheck,
  Palette,
  Users,
  Truck,
  CalendarSync,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanDo } from "@/lib/use-permissions";

const settingsNav = [
  { title: "General", href: "/settings", icon: Building2, permission: "orgSettings" as const },
  { title: "Billing", href: "/settings/billing", icon: CreditCard, permission: "orgSettings" as const },
  { title: "Assets", href: "/settings/assets", icon: Package, permission: "orgSettings" as const },
  { title: "Test & Tag", href: "/settings/test-and-tag", icon: ShieldCheck, permission: "orgSettings" as const },
  { title: "Services", href: "/settings/services", icon: Truck, permission: "orgSettings" as const },
  { title: "Branding", href: "/settings/branding", icon: Palette, permission: "orgSettings" as const },
  { title: "Calendars", href: "/settings/calendars", icon: CalendarSync, permission: "orgSettings" as const },
  { title: "Team", href: "/settings/team", icon: Users, permission: "orgMembers" as const },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const canReadSettings = useCanDo("orgSettings", "read");
  const canReadMembers = useCanDo("orgMembers", "read");

  if (!canReadSettings && !canReadMembers) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You don&apos;t have permission to access settings.
        </p>
      </div>
    );
  }

  const visibleNav = settingsNav.filter((item) => {
    if (item.permission === "orgSettings") return canReadSettings;
    if (item.permission === "orgMembers") return canReadMembers;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization and team.
        </p>
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
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
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
