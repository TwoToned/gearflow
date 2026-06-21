"use client";

import { useMemo } from "react";
import { Building2, Users, FolderOpen, Banknote } from "lucide-react";

import { useClients } from "@/hooks/use-clients";
import { useProjects } from "@/hooks/use-projects";
import { useActiveOrganization } from "@/lib/auth-client";
import { clientTypeLabels } from "@/lib/status-labels";
import { formatCurrency } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A project is "closed" once it's cancelled, completed, or invoiced — anything
 * else counts as open / live work. Mirrors the detail page's active-project
 * convention so the list and detail surfaces stay in sync.
 */
const CLOSED_PROJECT_STATUSES = new Set(["CANCELLED", "COMPLETED", "INVOICED"]);

/**
 * Clients dashboard header — a row of RVLT stat tiles derived entirely
 * client-side from the reactive clients + projects subscriptions the list
 * already needs. Sits above the client table (Retool/Zoho-style metric
 * cards across the top, table below). No new server actions.
 */
export function ClientsDashboard() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const clients = useClients(orgId);
  const projects = useProjects(orgId);

  const isLoading = clients === undefined || projects === undefined;

  const stats = useMemo(() => {
    const activeClients = (clients ?? []).filter((c) => (c.isActive ?? true) === true);

    // Non-template projects scoped to a client, keyed by clientId.
    const realProjects = (projects ?? []).filter((p) => !p.isTemplate);
    const openByClient = new Set<string>();
    let openProjectCount = 0;
    let totalValue = 0;
    for (const p of realProjects) {
      if (p.total != null) totalValue += Number(p.total);
      if (p.clientId && !CLOSED_PROJECT_STATUSES.has(p.status ?? "")) {
        openByClient.add(p.clientId);
        openProjectCount += 1;
      }
    }

    // Most common client type (the "by type" headline).
    const typeCounts = new Map<string, number>();
    for (const c of activeClients) {
      const t = c.type ?? "COMPANY";
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    let topType: string | null = null;
    let topTypeCount = 0;
    for (const [t, n] of typeCounts) {
      if (n > topTypeCount) {
        topType = t;
        topTypeCount = n;
      }
    }

    return {
      total: activeClients.length,
      withOpenWork: openByClient.size,
      openProjectCount,
      totalValue,
      topType,
      topTypeCount,
    };
  }, [clients, projects]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)]"
          >
            <Skeleton className="h-9 w-16" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  const tiles: { icon: typeof Building2; figure: string; label: string; bright?: boolean }[] = [
    {
      icon: Users,
      figure: String(stats.total),
      label: "Active clients",
      bright: true,
    },
    {
      icon: FolderOpen,
      figure: String(stats.withOpenWork),
      label:
        stats.openProjectCount > 0
          ? `With open work · ${stats.openProjectCount} live ${stats.openProjectCount === 1 ? "project" : "projects"}`
          : "With open work",
    },
    {
      icon: Banknote,
      figure: formatCurrency(stats.totalValue),
      label: "Total project value",
    },
    {
      icon: Building2,
      figure: stats.topType ? String(stats.topTypeCount) : "0",
      label: stats.topType
        ? `${clientTypeLabels[stats.topType] ?? stats.topType} · most common type`
        : "By type",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)]"
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "font-display font-extrabold leading-none tracking-tight tabular-nums",
                  tile.bright ? "text-[38px] text-ink" : "text-[24px] text-ink-2",
                )}
              >
                {tile.figure}
              </span>
              <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </div>
            <p className="mt-2 text-caption text-muted">{tile.label}</p>
          </div>
        );
      })}
    </div>
  );
}
