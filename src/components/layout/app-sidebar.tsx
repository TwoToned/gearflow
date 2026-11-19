"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavItems } from "@/hooks/use-nav-items";
import { RvltMark } from "@/components/brand/rvlt-mark";
import { RvltFlowLogo } from "@/components/brand/rvlt-flow-logo";
import { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { NAV_FOCUS } from "@/components/layout/nav-tone";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { SidebarGroups, SettingsRow } from "@/components/layout/sidebar-full";
import { RailRows } from "@/components/layout/sidebar-rail";
import { UserNav } from "./user-nav";

/** Manual collapse / expand (⌘B). Desktop only: below 1024px the rail is automatic. */
function CollapseButton({ collapsed, onClick }: { collapsed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "hidden cursor-pointer items-center rounded-[var(--r)] text-muted transition-colors hover:bg-elev hover:text-ink lg:flex",
        NAV_FOCUS,
        collapsed ? "w-full justify-center py-2" : "gap-2.5 px-2.5 py-1.5 text-[13px]",
      )}
    >
      {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4 shrink-0" />}
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Collapse</span>
          <kbd className="font-mono text-[11px] text-muted">⌘B</kbd>
        </>
      )}
    </button>
  );
}

function Brand({ compact }: { compact: boolean }) {
  return (
    <SidebarHeader className={cn("gap-1.5 border-b border-line", compact ? "items-center py-3" : "px-3 py-3")}>
      <Link href="/dashboard" aria-label="RVLT Flow — home" className={cn("flex items-center", !compact && "px-0.5 pb-0.5")}>
        {compact ? (
          <span className="flex size-9 items-center justify-center rounded-[var(--r)] bg-red shadow-[var(--lit)]">
            <RvltMark className="h-4 w-auto [&_path]:fill-white" />
          </span>
        ) : (
          <RvltFlowLogo className="h-5 w-auto" title="RVLT Flow" />
        )}
      </Link>
      <OrgSwitcher compact={compact} />
    </SidebarHeader>
  );
}

/**
 * The sidebar (220) and the tablet rail (72), both rendered from the one NAV
 * table via `useNavItems()` (gated rows are absent). D67: the rail at <= 1023px
 * is chosen by CSS, not JS, so the first paint is right; both views render and
 * `max-lg` / the collapsed-state group variant pick one. A phone has no sidebar
 * at all (the bottom nav + More sheet replace the drawer).
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { isMobile, toggleSidebar } = useSidebar();
  const { groups, settings } = useNavItems();
  const ctx = { pathname, onNavigate: () => {} };

  if (isMobile) return null;

  return (
    <Sidebar collapsible="icon" className="border-r border-line bg-paper-2">
      <div data-sidebar-view="full" className="flex min-h-0 flex-1 flex-col max-lg:hidden group-data-[collapsible=icon]:hidden">
        <Brand compact={false} />
        <SidebarContent className="gap-0 px-2 py-2" aria-label="Main">
          <SidebarGroups groups={groups} ctx={ctx} />
        </SidebarContent>
        <SidebarFooter className="gap-0.5 border-t border-line p-2">
          {settings && <SettingsRow item={settings} ctx={ctx} />}
          <UserNav />
          <CollapseButton onClick={toggleSidebar} />
        </SidebarFooter>
      </div>
      <div data-sidebar-view="rail" className="hidden min-h-0 flex-1 flex-col max-lg:flex group-data-[collapsible=icon]:flex">
        <Brand compact />
        <SidebarContent className="items-center gap-1 overflow-x-visible px-1 py-2" aria-label="Main">
          <RailRows groups={groups} ctx={ctx} />
        </SidebarContent>
        <SidebarFooter className="items-center gap-1 border-t border-line py-2">
          {settings && <SettingsRow item={settings} ctx={ctx} compact />}
          <UserNav compact />
          <CollapseButton collapsed onClick={toggleSidebar} />
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
