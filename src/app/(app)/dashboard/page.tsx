"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useNativeHome } from "@/hooks/use-native-dashboard";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { FadeIn } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { PageHeader } from "@/components/layout/page-header";
import { formatDateLong } from "@/lib/formatters";
import { useDashboardLayout, type LayoutRestore } from "@/hooks/use-dashboard-layout";
import { DashboardGrid, type LayoutChange } from "@/components/dashboard/dashboard-grid";
import { DashboardCustomizeBar } from "@/components/dashboard/dashboard-customize-bar";
import { DASHBOARD_WIDGET_REGISTRY, type DashboardLayoutWidget, type DashboardWidgetKind } from "@/lib/dashboard-widgets";
import { buildHomePageActions } from "@/lib/row-actions/home-page";
import { announceListWrite } from "@/lib/list-write-toast";

function homeTitle(now: Date, userName: string | undefined): string {
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = userName ? userName.split(" ")[0] : "";
  return firstName ? `${greeting}, ${firstName}` : greeting;
}

/** The page ⋯, gated once here: an action the viewer can't take is absent. */
function useHomePageMenu(isMobile: boolean, onCustomise: () => void) {
  const router = useRouter();
  const canWarehouse = useCanDo("warehouse", "read");
  const canAddGear = useCanDo("asset", "create");
  return buildHomePageActions({
    onWarehouse: canWarehouse ? () => router.push("/warehouse") : undefined,
    onAddGear: canAddGear ? () => router.push("/assets/registry/new") : undefined,
    onCustomise: isMobile ? undefined : onCustomise,
  });
}

/** Every layout change toasts with ONE Undo closure: the restore the layout hook returned (Q6). */
function announceLayout(title: string, restore: LayoutRestore | null) {
  if (!restore) return;
  announceListWrite({ title, undoneTitle: "Home layout put back", performUndo: async () => restore() });
}

/**
 * Customise mode's layout writes, each toasted with its own Undo. Kept out of
 * the page body so the page stays a thin composition.
 */
function useLayoutActions(orgId: string | undefined) {
  const layout = useDashboardLayout(orgId);
  // The two setup kinds are one panel: it is named as the panel, hidden and added as one.
  const titleOf = (kind: DashboardWidgetKind) =>
    DASHBOARD_WIDGET_REGISTRY[kind]?.setupSlot ? "Setup panel" : (DASHBOARD_WIDGET_REGISTRY[kind]?.title ?? "Widget");
  return {
    ...layout,
    change: (next: DashboardLayoutWidget[], c: LayoutChange) => announceLayout(`${c.verb} ${titleOf(c.kind)}`, layout.setLayout(next)),
    hide: (id: string) => {
      const kind = layout.widgets.find((w) => w.id === id)?.kind;
      announceLayout(`${kind ? titleOf(kind) : "Widget"} hidden · Add widget brings it back`, layout.removeWidget(id));
    },
    add: (kind: DashboardWidgetKind) => announceLayout(`${titleOf(kind)} added at the bottom`, layout.addWidget(kind)),
    reset: () => announceLayout("Home is back to the standard layout", layout.resetToDefault()),
  };
}

/**
 * `/dashboard`, Home (UX Phase 11, §6c, FEATUREDOCS/81). A fixed header (the
 * greeting, the date and org, one red `+ New job`, and a page ⋯ holding
 * Warehouse, Add gear and Customise…), then the per-user widget board.
 * Customise is desktop only (D89): on a phone the board is read-only and
 * `+ New job` is a sticky bar above the bottom nav.
 */
export default function DashboardPage() {
  const isMobile = useIsMobile();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const myHome = useNativeHome(orgId) as { userName?: string } | undefined;
  const layout = useLayoutActions(orgId);
  // Customise belongs to the org it was opened in: an org switch ends it (no effect needed).
  const [editOrg, setEditOrg] = useState<string | undefined>(undefined);
  const setEditMode = (on: boolean) => setEditOrg(on ? orgId : undefined);
  const editing = !!orgId && editOrg === orgId && !isMobile;
  const pageMenu = useHomePageMenu(isMobile, () => setEditMode(true));
  const now = new Date();

  return (
    <div className="space-y-6 max-md:pb-20">
      <FadeIn>
        <PageHeader
          title={homeTitle(now, myHome?.userName)}
          description={[formatDateLong(now), (activeOrg as { name?: string } | undefined)?.name].filter(Boolean).join(" · ")}
          actions={
            editing ? (
              <DashboardCustomizeBar
                availableToAdd={layout.availableToAdd}
                onAddWidget={layout.add}
                onReset={layout.reset}
                onDone={() => setEditMode(false)}
              />
            ) : (
              <>
                {!isMobile && (
                  <Button asChild variant="halo">
                    <Link href="/projects/new">
                      <Plus className="h-4 w-4" /> New job
                    </Link>
                  </Button>
                )}
                <ActionMenu
                  spec={pageMenu}
                  label="Home actions"
                  header={isMobile ? <p className="px-2 py-1.5 text-[12.5px] text-muted">Customise Home on a desktop. Your arrangement shows here in the same order.</p> : undefined}
                />
              </>
            )
          }
        />
      </FadeIn>

      <FadeIn delay={0.04}>
        <DashboardGrid widgets={layout.widgets} editMode={editing} orgId={orgId} onLayoutChange={layout.change} onRemove={layout.hide} />
      </FadeIn>

      {isMobile && (
        <PinnedAboveBottomNav>
          <Button asChild variant="halo" className="h-11 w-full text-[15px]">
            <Link href="/projects/new">
              <Plus className="h-4 w-4" /> New job
            </Link>
          </Button>
        </PinnedAboveBottomNav>
      )}
    </div>
  );
}
