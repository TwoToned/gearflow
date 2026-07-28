"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "./theme-toggle";
import { CommandSearch } from "./command-search";
import { Notifications } from "./notifications";
import { ShortcutsDialog } from "./shortcuts-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { usePlatformName } from "@/lib/use-platform-name";

/** Map route segments to display names */
const segmentLabels: Record<string, string> = {
  dashboard: "Dashboard",
  assets: "Assets",
  registry: "Registry",
  models: "Models",
  availability: "Availability",
  kits: "Kits",
  projects: "Projects",
  templates: "Templates",
  warehouse: "Warehouse",
  clients: "Clients",
  suppliers: "Suppliers",
  orders: "Orders",
  crew: "Crew",
  locations: "Locations",
  maintenance: "Maintenance",
  "test-and-tag": "Test & Tag",
  "quick-test": "Quick Test",
  categories: "Categories",
  reports: "Reports",
  builder: "Report Builder",
  settings: "Settings",
  billing: "Billing",
  services: "Services",
  branding: "Branding",
  team: "Team",
  activity: "Activity Log",
  account: "Account",
  changelog: "Changelog",
  new: "New",
  edit: "Edit",
  "pull-sheet": "Pull Sheet",
  timesheets: "Timesheets",
  planner: "Planner",
  sso: "Single Sign-On",
  displays: "Displays",
  woocommerce: "WooCommerce",
  xero: "Xero",
  "api-keys": "API Keys",
};

function getPageTitle(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Dashboard";

  // Build display breadcrumb, skipping ID-like segments
  const parts: string[] = [];
  for (const seg of segments) {
    const label = segmentLabels[seg];
    if (label) {
      parts.push(label);
    }
    // Skip ID segments (cuid, uuid, etc.)
  }

  return parts.length > 0 ? parts.join(" / ") : "Dashboard";
}

export function TopBar({ title }: { title?: string }) {
  const pathname = usePathname();
  const platformName = usePlatformName();
  const displayTitle = title || getPageTitle(pathname);

  // Update document title based on current page
  useEffect(() => {
    document.title = `${displayTitle} — ${platformName}`;
  }, [displayTitle, platformName]);

  return (
    <header className="sticky z-30 flex shrink-0 items-center gap-2 border-b border-line bg-paper/80 backdrop-blur-md px-4" style={{ top: 0, paddingTop: "env(safe-area-inset-top, 0px)", minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))" }}>
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4 hidden sm:block" />
      <Breadcrumb className="hidden sm:flex">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage className="truncate max-w-[200px]">{displayTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <CommandSearch />
        <ShortcutsDialog />
        <Notifications />
        <Separator orientation="vertical" className="h-4 hidden sm:block" />
        <span className="hidden sm:flex"><ThemeToggle /></span>
      </div>
    </header>
  );
}
