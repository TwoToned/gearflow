"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { useState } from "react";
import Link from "next/link";
import { useNativeDashboardStats, useNativeHome } from "@/hooks/use-native-dashboard";
import { useActiveOrganization } from "@/lib/auth-client";
import { ScanBarcode, Plus, Boxes } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { formatDateLong } from "@/lib/formatters";
import { useDashboardLayout } from "@/hooks/use-dashboard-layout";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { DashboardCustomizeBar } from "@/components/dashboard/dashboard-customize-bar";

const LIVE_STATUSES = new Set(["CHECKED_OUT", "ON_SITE"]);

/**
 * `/dashboard` — the customizable widget board (#1267; DESIGN.md "Dashboard
 * Layout" documents the "no widget boards" decision this supersedes, and
 * FEATUREDOCS/81 has the full writeup). The greeting hero + quick actions
 * stay a FIXED page header (never a widget, per that decision); everything
 * below it is `<DashboardGrid>`, backed by `useDashboardLayout` (per-user
 * saved arrangement, `convex/dashboardLayouts.ts`).
 */
export default function DashboardPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Kept at the page level purely to compose the hero's "aside" line — the
  // greeting is fixed page furniture, not a widget, so it needs this
  // regardless of what's on the board. Same hooks the widgets themselves
  // use (R-3.1) — Convex shares the underlying subscription, so this isn't a
  // second read, just a second call site of one.
  const nativeStats = useNativeDashboardStats(orgId);
  const stats = nativeStats.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myHome = useNativeHome(orgId) as any;

  const { widgets, setLayout, addWidget, removeWidget, resetToDefault, availableToAdd } = useDashboardLayout(orgId);
  const [editMode, setEditMode] = useState(false);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = myHome?.userName ? String(myHome.userName).split(" ")[0] : "";

  const myProjects = (myHome?.myProjects ?? []) as Record<string, unknown>[];
  const liveJobs = myProjects.filter((p) => LIVE_STATUSES.has(p.status as string));

  const overdue = stats?.overdueReturns ?? 0;
  // §9: overdue is an alert context — plain copy, no personality/Kalam. The
  // calm and zero branches keep the handwritten voice.
  const asideOverdue = !!stats && overdue > 0;
  const aside = !stats
    ? ""
    : asideOverdue
      ? `${overdue} overdue return${overdue > 1 ? "s" : ""} need review.`
      : liveJobs.length > 0
        ? `${liveJobs.length} out on the floor, nothing on fire.`
        : "Nothing needs you. Suspicious.";

  return (
    <div className="space-y-6">
      <FadeIn>
        <PageHeader
          title={`${greeting}${firstName ? `, ${firstName}` : ""}`}
          description={formatDateLong(now)}
          meta={
            aside &&
            (asideOverdue ? (
              <p className="text-ui-text font-medium text-t-out">{aside}</p>
            ) : (
              <p className="font-hand text-[15px] text-t-out">{aside}</p>
            ))
          }
          actions={
            <>
              <Button asChild variant="halo">
                <Link href="/projects/new">
                  <Plus className="h-4 w-4" /> New job
                </Link>
              </Button>
              <Button asChild variant="line" className="hidden sm:inline-flex">
                <Link href="/warehouse">
                  <ScanBarcode className="h-4 w-4" /> Warehouse
                </Link>
              </Button>
              <Button asChild variant="line" className="hidden sm:inline-flex">
                <Link href="/assets/registry/new">
                  <Boxes className="h-4 w-4" /> Add gear
                </Link>
              </Button>
              <DashboardCustomizeBar
                editMode={editMode}
                onToggleEditMode={() => setEditMode((v) => !v)}
                availableToAdd={availableToAdd}
                onAddWidget={addWidget}
                onReset={resetToDefault}
              />
            </>
          }
        />
      </FadeIn>

      <FadeIn delay={0.04}>
        <DashboardGrid
          widgets={widgets}
          editMode={editMode}
          orgId={orgId}
          onLayoutChange={setLayout}
          onRemove={removeWidget}
        />
      </FadeIn>
    </div>
  );
}
