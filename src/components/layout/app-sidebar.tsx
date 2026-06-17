"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  FolderOpen,
  Users,
  Settings,
  CalendarRange,
  ChevronRight,
  FileText,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { usePlatformBranding } from "@/lib/use-platform-name";
import { useCurrentRole } from "@/lib/use-permissions";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { getBuildInfo } from "@/server/changelog";
import type { Resource } from "@/lib/permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** Module wayfinding hue (DESIGN.md §15.5) applied to the Lucide icon */
  tint?: string;
  /** Resource key — if set, item is hidden when user has no access to this resource */
  resource?: Resource;
  items?: { title: string; url: string; icon: LucideIcon; resource?: Resource }[];
}

// ── Section definitions ──────────────────────────────────────────────
// Each section has a label (rendered as overline) and its nav items.

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "RVLT FLOW",
    // Module hues per DESIGN.md §15.5: Jobs=blue · Crew=purple · Gear=amber.
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Jobs", url: "/projects", icon: FolderOpen, tint: "text-blue", resource: "project" },
      { title: "Schedule", url: "/crew/planner", icon: CalendarRange, tint: "text-purple", resource: "crew" },
      { title: "Crew", url: "/crew", icon: Users, tint: "text-purple", resource: "crew" },
      { title: "Equipment", url: "/assets/registry", icon: Package, tint: "text-amber", resource: "asset" },
      { title: "Quotes", url: "/quotes", icon: FileText, tint: "text-blue", resource: "project" },
    ],
  },
];

/** Check if the current path is within a nav item or any of its children */
function isWithinItem(pathname: string, item: NavItem): boolean {
  if (pathname === item.url || pathname.startsWith(item.url + "/")) return true;
  return !!item.items?.some(
    (sub) => pathname === sub.url || pathname.startsWith(sub.url + "/")
  );
}

// ── Quick-create actions ─────────────────────────────────────────────

interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  resource?: Resource;
}

const quickActions: QuickAction[] = [
  { label: "New Project", href: "/projects/new", icon: FolderOpen, resource: "project" },
  { label: "New Asset", href: "/assets/registry/new", icon: Package, resource: "asset" },
  { label: "New Client", href: "/clients/new", icon: Users, resource: "client" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { icon: platformIcon } = usePlatformBranding();
  const { permissions, isLoading } = useCurrentRole();
  const { isMobile, setOpenMobile } = useSidebar();

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

  /** Render a single nav item (with or without sub-items) */
  const renderNavItem = (item: NavItem) => {
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
            <item.icon className={`h-4 w-4 ${item.tint ?? ""}`} />
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
          <item.icon className={`h-4 w-4 ${item.tint ?? ""}`} />
          <span>{item.title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  // Filter quick actions by permission
  const visibleQuickActions = quickActions.filter((a) => hasAccess(a.resource));

  return (
    <Sidebar className="border-r-2 border-line-2 bg-paper-2 p-2 text-ink">
      {/* ── Brand header ──────────────────────────────────────── */}
      <SidebarHeader className="border-b-2 border-line-2 px-2 py-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="group/brand flex min-w-0 items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border bg-red text-white font-display text-[16px] font-black shadow-[var(--sh-card),var(--lit)]">
              {platformIcon ? (
                <DynamicIcon name={platformIcon} className="h-5 w-5" />
              ) : (
                "R"
              )}
            </div>
            <span className="truncate text-[20px] leading-none tracking-[-0.03em]">
              <span className="font-display font-black">RVLT</span>{" "}
              <span className="font-sans font-semibold text-ink-2">Flow</span>
            </span>
          </Link>
          <Link
            href="/changelog"
            className="ml-auto rounded-full border border-line px-2 py-1 font-mono text-[11px] font-bold text-muted transition-colors hover:bg-elev hover:text-ink"
          >
            {buildLabel}
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* ── Quick Create ────────────────────────────────────── */}
        {visibleQuickActions.length > 0 && (
          <div className="px-3 pt-3 pb-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-border bg-elev px-3 py-2 text-[14px] font-semibold text-ink shadow-[var(--sh-card),var(--lit)] transition-transform hover:-translate-y-0.5 active:translate-y-0.5">
                <Plus className="h-4 w-4" />
                <span>Quick Create</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="start" sideOffset={4} className="w-48">
                {visibleQuickActions.map((action) => (
                  <DropdownMenuItem
                    key={action.href}
                    onClick={() => {
                      closeMobile();
                      router.push(action.href);
                    }}
                  >
                    <action.icon className="mr-2 h-4 w-4" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* ── Sectioned navigation ────────────────────────────── */}
        {navSections.map((section) => {
          const visibleItems = section.items.filter((item) => hasAccess(item.resource));
          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={section.label} className="py-1">
              <SidebarGroupLabel className="t-overline text-fg-4 px-4 mb-0.5">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map(renderNavItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {/* ── Settings (pushed to bottom) ─────────────────────── */}
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

      {/* ── Footer / user nav ─────────────────────────────────── */}
      <SidebarFooter className="border-t border-sidebar-border">
        <UserNav />
      </SidebarFooter>
    </Sidebar>
  );
}
