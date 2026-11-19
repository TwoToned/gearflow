"use client";

import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CommandSearch } from "./command-search";
import { Notifications } from "./notifications";
import { MiraLauncher } from "@/components/mira/mira-launcher";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Breadcrumbs, useTrail } from "@/components/layout/breadcrumbs";
import { NavLink } from "@/components/layout/nav-link";
import { usePlatformName } from "@/lib/use-platform-name";

/** The page's identity for the tab title: the trail's last segment (one source, §6d.9). */
function useDocumentTitle(title: string) {
  const platformName = usePlatformName();
  useEffect(() => {
    document.title = `${title} — ${platformName}`;
  }, [title, platformName]);
}

/**
 * The top bar (56): a real trail (`Jobs › #2341 Hilton › Equipment`, each segment a
 * link, the last in ink), the search field, then the shell actions. On a phone the
 * trail collapses to a back chevron (to the parent crumb) and the title.
 */
export function TopBar() {
  const trail = useTrail();
  const title = trail[trail.length - 1].label;
  const parentHref = trail.length > 1 ? trail[trail.length - 2].href : undefined;
  useDocumentTitle(title);

  return (
    <header
      className="sticky z-30 flex shrink-0 items-center gap-2 border-b border-line bg-paper/80 px-4 backdrop-blur-md"
      style={{ top: 0, paddingTop: "env(safe-area-inset-top, 0px)", minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))" }}
    >
      {/* Hidden <= 1023px: the rail is forced at 860-1023 (D67) and a phone has no drawer (bottom nav + More). */}
      <SidebarTrigger className="-ml-1 max-lg:hidden" />
      {parentHref && (
        <NavLink href={parentHref} aria-label="Back" className="-ml-2 grid size-11 shrink-0 place-items-center rounded-[var(--r)] text-ink md:hidden">
          <ChevronLeft className="size-5" />
        </NavLink>
      )}
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink md:hidden">{title}</span>
      <Breadcrumbs trail={trail} className="hidden flex-1 md:block" />
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <CommandSearch />
        <ShortcutsDialog />
        <MiraLauncher />
        <Notifications />
      </div>
    </header>
  );
}
