"use client";

import * as React from "react";
import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ListTodo,
  Package,
  Boxes,
  FolderOpen,
  Users,
  MapPin,
  Wrench,
  BarChart3,
  TrendingUp,
  ScrollText,
  Settings,
  CalendarRange,
  Warehouse,
  Container,
  ShieldCheck,
  BookTemplate,
  Tags,
  Truck,
  HardHat,
  Clock,
  MoreHorizontal,
  AlertTriangle,
  Undo2,
  Landmark,
  PackagePlus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentRole } from "@/lib/use-permissions";
import { RvltMark } from "@/components/brand/rvlt-mark";
import { RvltFlowLogo } from "@/components/brand/rvlt-flow-logo";
import type { Resource } from "@/lib/permissions";
import { type ModuleHue } from "@/components/ui/feature-patch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { UserNav } from "./user-nav";

/**
 * A plain <a> that navigates via useRouter instead of Next.js <Link>.
 * Avoids the "removeChild" DOM conflict from <Link>'s internal DOM
 * manipulation interacting with Base UI's useRender composition. NEVER
 * replace with a plain <Link> for nav items (DOM crash on navigation).
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

interface SubItem {
  title: string;
  url: string;
  icon: LucideIcon;
  resource?: Resource;
}
interface RailItem {
  title: string;
  url: string;
  icon: LucideIcon;
  hue: ModuleHue;
  resource?: Resource;
  subs?: SubItem[];
}

// Primary modules. Hues per DESIGN.md §3.7/§15.5.
const RAIL: RailItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, hue: "blue" },
  // No `resource` gate — personal scope (this user's own assignments), not an
  // org resource. A resource gate here would fail-open-flash on load like every
  // other gated item; skipping it entirely (rather than gating on "project")
  // means viewer/warehouse roles keep their own task list even without
  // project:read. Sidebar-only per DESIGN.md §16 — NOT in the mobile bottom nav
  // (that's the 5 daily-operator workflows; see mobile-nav.tsx).
  { title: "My tasks", url: "/my-tasks", icon: ListTodo, hue: "blue" },
  {
    title: "Projects", url: "/projects", icon: FolderOpen, hue: "blue", resource: "project",
    subs: [
      { title: "Templates", url: "/projects/templates", icon: BookTemplate, resource: "project" },
      // WS3 #942 — org-wide hard/pencilled overbooking + crew-gap board.
      // Blue (Projects hue, per spec) rather than its own hue — this is a
      // projects-adjacent risk view, not a separate module.
      { title: "Overbookings", url: "/overbookings", icon: AlertTriangle, resource: "project" },
    ],
  },
  // #992 (Phase F) — org-wide "what's chaseable" finance view: quotes out,
  // expiring, never sent, confirmed-uninvoiced, deposit due, outstanding.
  // Gated on `invoice` (same resource the per-project Finance tab uses).
  { title: "Finance", url: "/finance", icon: Landmark, hue: "green", resource: "invoice" },
  { title: "Schedule", url: "/availability", icon: CalendarRange, hue: "green", resource: "asset" },
  {
    title: "Crew", url: "/crew", icon: HardHat, hue: "purple", resource: "crew",
    subs: [
      { title: "Planner", url: "/crew/planner", icon: CalendarRange, resource: "crew" },
      { title: "Timesheets", url: "/crew/timesheets", icon: Clock, resource: "crew" },
    ],
  },
  {
    title: "Assets", url: "/assets/registry", icon: Package, hue: "amber", resource: "asset",
    subs: [
      { title: "Models", url: "/assets/models", icon: Boxes, resource: "model" },
      { title: "Categories", url: "/assets/categories", icon: Tags, resource: "model" },
      { title: "Kits", url: "/kits", icon: Container, resource: "kit" },
      { title: "Fleet ROI", url: "/assets/roi", icon: TrendingUp, resource: "model" },
      // WS11 (#950) follow-up — manage the NEW_STOCK sale-stock pool per model.
      { title: "Sales Stock", url: "/assets/sales-stock", icon: PackagePlus, resource: "model" },
    ],
  },
  {
    title: "Warehouse", url: "/warehouse", icon: Warehouse, hue: "teal", resource: "warehouse",
    subs: [{ title: "Returns", url: "/warehouse/returns", icon: Undo2, resource: "warehouse" }],
  },
  {
    title: "Test & Tag", url: "/test-and-tag", icon: ShieldCheck, hue: "teal", resource: "testTag",
    subs: [
      { title: "Registry", url: "/test-and-tag/registry", icon: Package, resource: "testTag" },
      { title: "Quick Test", url: "/test-and-tag/quick-test", icon: ShieldCheck, resource: "testTag" },
      { title: "Reports", url: "/test-and-tag/reports", icon: BarChart3, resource: "reports" },
    ],
  },
  { title: "Maintenance", url: "/maintenance", icon: Wrench, hue: "coral", resource: "maintenance" },
];

// Secondary destinations — own group at the bottom (expanded) / "More" flyout (rail).
const MORE: SubItem[] = [
  { title: "Clients", url: "/clients", icon: Users, resource: "client" },
  { title: "Suppliers", url: "/suppliers", icon: Truck, resource: "supplier" },
  { title: "Locations", url: "/locations", icon: MapPin, resource: "location" },
  { title: "Activity Log", url: "/activity", icon: ScrollText, resource: "reports" },
];

// Literal hue → class maps (Tailwind can't see dynamic `text-${hue}`).
const hueText: Record<ModuleHue, string> = {
  blue: "text-blue", amber: "text-amber", green: "text-green",
  purple: "text-purple", coral: "text-coral", teal: "text-teal",
};
const hueSoftBg: Record<ModuleHue, string> = {
  blue: "bg-blue-soft", amber: "bg-amber-soft", green: "bg-green-soft",
  purple: "bg-purple-soft", coral: "bg-coral-soft", teal: "bg-teal-soft",
};
const hueHoverText: Record<ModuleHue, string> = {
  blue: "hover:text-blue", amber: "hover:text-amber", green: "hover:text-green",
  purple: "hover:text-purple", coral: "hover:text-coral", teal: "hover:text-teal",
};
const hueHoverBg: Record<ModuleHue, string> = {
  blue: "hover:bg-blue-soft", amber: "hover:bg-amber-soft", green: "hover:bg-green-soft",
  purple: "hover:bg-purple-soft", coral: "hover:bg-coral-soft", teal: "hover:bg-teal-soft",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

function isWithin(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(url + "/");
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { permissions, isLoading } = useCurrentRole();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const closeMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const go = useCallback((url: string) => { closeMobile(); router.push(url); }, [closeMobile, router]);

  const hasAccess = useCallback((resource?: Resource): boolean => {
    if (!resource) return true;
    if (isLoading || !permissions) return true;
    const actions = permissions[resource];
    return !!actions && actions.length > 0;
  }, [isLoading, permissions]);

  const railItems = RAIL.filter((i) => hasAccess(i.resource));
  const moreItems = MORE.filter((i) => hasAccess(i.resource));
  const moreActive = moreItems.some((i) => isWithin(pathname, i.url));
  const settingsVisible = hasAccess("orgSettings") || hasAccess("orgMembers");

  // ── Collapsed rail: icon + label, hue on hover, hover-reveal flyout for subs ──
  const railItemClass = (active: boolean, hue: ModuleHue) =>
    cn(
      "group relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-[var(--r)] px-1 py-2 transition-colors", FOCUS,
      active
        ? `${hueSoftBg[hue]} ${hueText[hue]} shadow-[var(--sh-card)]`
        : `text-muted ${hueHoverBg[hue]} ${hueHoverText[hue]}`,
    );

  const renderRail = () => (
    <>
      <SidebarContent className="items-center gap-1 overflow-x-visible px-2 py-2">
        {railItems.map((item) => {
          const active = isWithin(pathname, item.url) || !!item.subs?.some((s) => isWithin(pathname, s.url));
          const subs = item.subs?.filter((s) => hasAccess(s.resource)) ?? [];
          if (subs.length === 0) {
            return (
              <NavLink key={item.title} href={item.url} onClick={closeMobile} className={railItemClass(active, item.hue)}>
                <item.icon className="size-5" />
                <span className="text-[11px] font-medium leading-none">{item.title}</span>
              </NavLink>
            );
          }
          const open = hoverKey === item.title;
          return (
            <DropdownMenu key={item.title} open={open} onOpenChange={(o) => setHoverKey(o ? item.title : null)}>
              <DropdownMenuTrigger asChild>
                <button type="button" onMouseEnter={() => setHoverKey(item.title)} className={railItemClass(active, item.hue)}>
                  <item.icon className="size-5" />
                  <span className="text-[11px] font-medium leading-none">{item.title}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-52" onMouseLeave={() => setHoverKey(null)}>
                <DropdownMenuLabel className={hueText[item.hue]}>{item.title}</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => go(item.url)}>
                    <item.icon className="mr-2 h-4 w-4" /> Open {item.title}
                  </DropdownMenuItem>
                  {subs.map((s) => (
                    <DropdownMenuItem key={s.url} onClick={() => go(s.url)}>
                      <s.icon className="mr-2 h-4 w-4" /> {s.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}

        {moreItems.length > 0 && (
          <DropdownMenu open={hoverKey === "__more"} onOpenChange={(o) => setHoverKey(o ? "__more" : null)}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onMouseEnter={() => setHoverKey("__more")}
                className={cn(
                  "group flex w-full cursor-pointer flex-col items-center gap-1 rounded-[var(--r)] px-1 py-2 transition-colors", FOCUS,
                  moreActive ? "bg-elev text-ink" : "text-muted hover:bg-elev hover:text-ink",
                )}
              >
                <MoreHorizontal className="size-5" />
                <span className="text-[11px] font-medium leading-none">More</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-52" onMouseLeave={() => setHoverKey(null)}>
              <DropdownMenuLabel>More</DropdownMenuLabel>
              <DropdownMenuGroup>
                {moreItems.map((m) => (
                  <DropdownMenuItem key={m.url} onClick={() => go(m.url)}>
                    <m.icon className="mr-2 h-4 w-4" /> {m.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarContent>

      <SidebarFooter className="items-center gap-1 border-t border-line py-2">
        {settingsVisible && (
          <NavLink
            href="/settings"
            onClick={closeMobile}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center gap-1 rounded-[var(--r)] px-1 py-2 transition-colors", FOCUS,
              isWithin(pathname, "/settings") ? "bg-elev text-ink" : "text-muted hover:bg-elev hover:text-ink",
            )}
          >
            <Settings className="size-5" />
            <span className="text-[11px] font-medium leading-none">Settings</span>
          </NavLink>
        )}
        <UserNav />
      </SidebarFooter>
    </>
  );

  // ── Expanded: full sidebar, every module + its sub-items inline (no menus) ──
  const moduleRow = (item: RailItem) => {
    const active = isWithin(pathname, item.url) || !!item.subs?.some((s) => isWithin(pathname, s.url));
    return (
      <NavLink
        href={item.url}
        onClick={closeMobile}
        className={cn(
          "flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 text-[14px] font-medium transition-colors", FOCUS,
          active
            ? `${hueSoftBg[item.hue]} ${hueText[item.hue]} shadow-[var(--sh-card)]`
            : `text-ink-2 ${hueHoverBg[item.hue]} ${hueHoverText[item.hue]}`,
        )}
      >
        <item.icon className="size-4 shrink-0" />
        <span className="truncate">{item.title}</span>
      </NavLink>
    );
  };

  const subRow = (sub: SubItem, hue: ModuleHue) => {
    const active = isWithin(pathname, sub.url);
    return (
      <NavLink
        key={sub.url}
        href={sub.url}
        onClick={closeMobile}
        className={cn(
          "flex items-center gap-2 rounded-[var(--r)] py-1.5 pl-9 pr-2.5 text-[13px] transition-colors", FOCUS,
          active ? `bg-elev ${hueText[hue]}` : `text-muted ${hueHoverText[hue]} hover:bg-elev`,
        )}
      >
        <span className="truncate">{sub.title}</span>
      </NavLink>
    );
  };

  const renderExpanded = () => (
    <>
      <SidebarContent className="gap-0.5 px-2 py-2">
        {railItems.map((item) => {
          const subs = item.subs?.filter((s) => hasAccess(s.resource)) ?? [];
          return (
            <div key={item.title} className="flex flex-col">
              {moduleRow(item)}
              {subs.map((s) => subRow(s, item.hue))}
            </div>
          );
        })}

        {moreItems.length > 0 && (
          <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
            <span className="t-overline px-2.5 pb-1 text-faint">More</span>
            {moreItems.map((m) => {
              const active = isWithin(pathname, m.url);
              return (
                <NavLink
                  key={m.url}
                  href={m.url}
                  onClick={closeMobile}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 text-[14px] transition-colors", FOCUS,
                    active ? "bg-elev text-ink" : "text-ink-2 hover:bg-elev hover:text-ink",
                  )}
                >
                  <m.icon className="size-4 shrink-0" />
                  <span className="truncate">{m.title}</span>
                </NavLink>
              );
            })}
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-0.5 border-t border-line p-2">
        {settingsVisible && (
          <NavLink
            href="/settings"
            onClick={closeMobile}
            className={cn(
              "flex items-center gap-2.5 rounded-[var(--r)] px-2.5 py-2 text-[14px] font-medium transition-colors", FOCUS,
              isWithin(pathname, "/settings") ? "bg-elev text-ink" : "text-ink-2 hover:bg-elev hover:text-ink",
            )}
          >
            <Settings className="size-4 shrink-0" />
            <span className="truncate">Settings</span>
          </NavLink>
        )}
        <UserNav />
      </SidebarFooter>
    </>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-line bg-paper-2">
      <SidebarHeader className={cn("border-b border-line", collapsed ? "items-center py-3" : "px-3 py-3.5")}>
        <Link href="/dashboard" aria-label="RVLT Flow — dashboard" className="flex items-center">
          {collapsed ? (
            <span className="flex size-9 items-center justify-center rounded-[var(--r)] bg-red shadow-[var(--lit)]">
              <RvltMark className="h-4 w-auto [&_path]:fill-white" />
            </span>
          ) : (
            <RvltFlowLogo className="h-5 w-auto" title="RVLT Flow" />
          )}
        </Link>
      </SidebarHeader>
      {collapsed ? renderRail() : renderExpanded()}
    </Sidebar>
  );
}
