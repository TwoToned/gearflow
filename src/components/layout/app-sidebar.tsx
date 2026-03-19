"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Boxes,
  FolderOpen,
  Users,
  MapPin,
  Wrench,
  BarChart3,
  ScrollText,
  Settings,
  CalendarRange,
  Warehouse,
  Container,
  ShieldCheck,
  BookTemplate,
  ChevronRight,
  Tags,
  Truck,
  HardHat,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { usePlatformBranding } from "@/lib/use-platform-name";
import { useCurrentRole } from "@/lib/use-permissions";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { getBuildInfo } from "@/server/changelog";
import type { Resource } from "@/lib/permissions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { UserNav } from "./user-nav";

/**
 * A plain <a> that navigates via useRouter instead of Next.js <Link>.
 * Avoids the "removeChild" DOM conflict caused by <Link>'s internal
 * DOM manipulation interacting with Base UI's useRender composition.
 */
const NavLink = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>(function NavLink({ href, onClick, children, ...props }, ref) {
  const router = useRouter();
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
        router.push(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
});

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Resource key — if set, item is hidden when user has no access to this resource */
  resource?: Resource;
  items?: { title: string; url: string; icon: LucideIcon; resource?: Resource }[];
}

const navItems: NavItem[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Assets",
    url: "/assets/registry",
    icon: Package,
    resource: "asset",
    items: [
      { title: "Models", url: "/assets/models", icon: Boxes, resource: "model" },
      { title: "Categories", url: "/assets/categories", icon: Tags, resource: "model" },
      { title: "Kits", url: "/kits", icon: Container, resource: "kit" },
    ],
  },
  {
    title: "Projects",
    url: "/projects",
    icon: FolderOpen,
    resource: "project",
    items: [
      { title: "Templates", url: "/projects/templates", icon: BookTemplate, resource: "project" },
    ],
  },
  {
    title: "Availability",
    url: "/availability",
    icon: CalendarRange,
    resource: "asset",
  },
  {
    title: "Warehouse",
    url: "/warehouse",
    icon: Warehouse,
    resource: "warehouse",
  },
  {
    title: "Clients",
    url: "/clients",
    icon: Users,
    resource: "client",
  },
  {
    title: "Suppliers",
    url: "/suppliers",
    icon: Truck,
    resource: "supplier",
  },
  {
    title: "Crew",
    url: "/crew",
    icon: HardHat,
    resource: "crew",
    items: [
      { title: "Planner", url: "/crew/planner", icon: CalendarRange, resource: "crew" },
      { title: "Timesheets", url: "/crew/timesheets", icon: Clock, resource: "crew" },
      { title: "Roles & Skills", url: "/crew/settings", icon: Settings, resource: "crew" },
    ],
  },
  {
    title: "Locations",
    url: "/locations",
    icon: MapPin,
    resource: "location",
  },
  {
    title: "Maintenance",
    url: "/maintenance",
    icon: Wrench,
    resource: "maintenance",
  },
  {
    title: "Test & Tag",
    url: "/test-and-tag",
    icon: ShieldCheck,
    resource: "testTag",
    items: [
      { title: "Registry", url: "/test-and-tag/registry", icon: Package, resource: "testTag" },
      { title: "Quick Test", url: "/test-and-tag/quick-test", icon: ShieldCheck, resource: "testTag" },
      { title: "Reports", url: "/test-and-tag/reports", icon: BarChart3, resource: "reports" },
    ],
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart3,
    resource: "reports",
  },
  {
    title: "Activity Log",
    url: "/activity",
    icon: ScrollText,
    resource: "reports",
  },
];

/** Check if the current path is within a nav item or any of its children */
function isWithinItem(pathname: string, item: NavItem): boolean {
  if (pathname === item.url || pathname.startsWith(item.url + "/")) return true;
  return !!item.items?.some(
    (sub) => pathname === sub.url || pathname.startsWith(sub.url + "/")
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { name: platformName, icon: platformIcon } = usePlatformBranding();
  const { permissions, isLoading } = useCurrentRole();
  const { isMobile, setOpenMobile } = useSidebar();
  const initials = platformName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const closeMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  // Build info for version display
  const [buildLabel, setBuildLabel] = useState("");
  useEffect(() => {
    getBuildInfo().then((info) => setBuildLabel(`#${info.commitCount}.${info.hash}`));
  }, []);

  // Pinned = manually toggled open via chevron button (persists across navigation)
  // Auto-expanded sections only stay open while the path is inside them
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const togglePinned = useCallback((title: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }, []);

  // A section is visible if it's pinned OR the user is currently inside it
  const isSectionOpen = useCallback(
    (item: NavItem) => pinned.has(item.title) || isWithinItem(pathname, item),
    [pinned, pathname]
  );

  /** Check if user has ANY permission (including "read") for a resource */
  const hasAccess = (resource?: Resource): boolean => {
    if (!resource) return true;
    if (isLoading || !permissions) return true;
    const actions = permissions[resource];
    return !!actions && actions.length > 0;
  };

  const visibleItems = navItems.filter((item) => hasAccess(item.resource));

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
              {platformIcon ? (
                <DynamicIcon name={platformIcon} className="h-4 w-4" />
              ) : (
                initials
              )}
            </div>
            <span className="font-semibold text-lg tracking-tight">{platformName}</span>
          </Link>
          <Link
            href="/changelog"
            className="ml-auto text-[10px] font-mono font-medium text-fg-3 hover:text-fg transition-colors bg-bg-inset/50 hover:bg-bg-inset px-1.5 py-0.5 rounded-md"
          >
            {buildLabel}
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const visibleSubs = item.items?.filter((sub) => hasAccess(sub.resource));
                const hasSubs = visibleSubs && visibleSubs.length > 0;
                const isOpen = hasSubs && isSectionOpen(item);
                const isActive = pathname === item.url || pathname.startsWith(item.url + "/");

                return hasSubs ? (
                  <SidebarMenuItem key={item.title}>
                    <div className="flex items-center">
                      <SidebarMenuButton
                        render={<NavLink href={item.url!} onClick={closeMobile} />}
                        isActive={isActive}
                        className="flex-1"
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      <button
                        onClick={() => togglePinned(item.title)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition-transform duration-200 ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        />
                      </button>
                    </div>
                    {isOpen && (
                      <SidebarMenuSub>
                        {visibleSubs.map((sub) => (
                          <SidebarMenuSubItem key={sub.title}>
                            <SidebarMenuSubButton
                              render={<NavLink href={sub.url} onClick={closeMobile} />}
                              isActive={pathname === sub.url || pathname.startsWith(sub.url + "/")}
                            >
                              <sub.icon className="h-4 w-4" />
                              <span>{sub.title}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={<NavLink href={item.url} onClick={closeMobile} />}
                      isActive={isActive}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem className={(hasAccess("orgSettings") || hasAccess("orgMembers")) ? "" : "hidden"}>
                <SidebarMenuButton
                  render={<NavLink href="/settings" onClick={closeMobile} />}
                  isActive={pathname.startsWith("/settings")}
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <UserNav />
      </SidebarFooter>
    </Sidebar>
  );
}
