"use client";

import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRight,
  AlertTriangle,
  Wrench,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  Boxes,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StaggerList, StaggerItem } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { getStatusIntent } from "@/lib/status-colors";

const intentBorder: Record<string, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  error: "border-l-error",
  info: "border-l-info",
  neutral: "border-l-fg-3",
  primary: "border-l-primary",
};

const projectStatusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

type Project = Record<string, unknown>;
interface Stats {
  overdueReturns?: number;
  maintenanceDue?: number;
  pendingCrewOffers?: number;
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** A friendly, status-aware date line for a project card. */
function projectDateLine(p: Project): { text: string; tone: "error" | "warning" | "muted" } | null {
  const status = p.status as string;
  const now = startOfDay(new Date());
  const start = p.rentalStartDate ? startOfDay(new Date(p.rentalStartDate as string)) : null;
  const end = p.rentalEndDate ? startOfDay(new Date(p.rentalEndDate as string)) : null;
  const deployed = ["CHECKED_OUT", "ON_SITE", "PREPPING"].includes(status);

  if (deployed && end) {
    const days = Math.round((end.getTime() - now.getTime()) / DAY);
    if (days < 0) return { text: `Overdue ${Math.abs(days)}d`, tone: "error" };
    if (days === 0) return { text: "Returns today", tone: "warning" };
    if (days <= 3) return { text: `Returns in ${days}d`, tone: "warning" };
    return { text: `Returns ${format(end, "d MMM")}`, tone: "muted" };
  }
  if (start) {
    const days = Math.round((start.getTime() - now.getTime()) / DAY);
    if (days < 0) return { text: `Started ${format(start, "d MMM")}`, tone: "muted" };
    if (days === 0) return { text: "Starts today", tone: "warning" };
    if (days <= 7) return { text: `Starts in ${days}d`, tone: days <= 2 ? "warning" : "muted" };
    return { text: `Starts ${format(start, "d MMM")}`, tone: "muted" };
  }
  return null;
}

export function MyWorkSection({ projects, stats }: { projects: Project[]; stats?: Stats }) {
  const now = startOfDay(new Date());
  const weekAhead = now.getTime() + 7 * DAY;

  const startingThisWeek = projects.filter((p) => {
    if (!p.rentalStartDate) return false;
    const t = startOfDay(new Date(p.rentalStartDate as string)).getTime();
    return t >= now.getTime() && t <= weekAhead;
  }).length;

  const chips = [
    stats?.overdueReturns
      ? { href: "/projects", label: `${stats.overdueReturns} overdue return${stats.overdueReturns > 1 ? "s" : ""}`, cls: "bg-error-subtle text-error hover:bg-error/15", Icon: AlertTriangle }
      : null,
    stats?.maintenanceDue
      ? { href: "/maintenance", label: `${stats.maintenanceDue} maintenance due`, cls: "bg-warning-subtle text-warning hover:bg-warning/15", Icon: Wrench }
      : null,
    stats?.pendingCrewOffers
      ? { href: "/crew", label: `${stats.pendingCrewOffers} crew offer${stats.pendingCrewOffers > 1 ? "s" : ""} pending`, cls: "bg-info-subtle text-info hover:bg-info/15", Icon: UserCheck }
      : null,
  ].filter(Boolean) as { href: string; label: string; cls: string; Icon: typeof Wrench }[];

  return (
    <section className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <SectionHeader label="Your projects" />
          {projects.length > 0 && (
            <p className="t-micro text-fg-3 mt-0.5">
              Managing {projects.length} project{projects.length > 1 ? "s" : ""}
              {startingThisWeek > 0 && <> · {startingThisWeek} starting this week</>}
            </p>
          )}
        </div>
        <Link
          href="/projects"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          All projects <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-fg-4" />
          <p className="mt-2 text-sm font-medium">No projects assigned to you</p>
          <p className="t-micro text-fg-3">
            Projects where you&rsquo;re the manager show up here. Set a manager on a project to see it.
          </p>
        </div>
      ) : (
        <StaggerList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.slice(0, 9).map((p) => {
            const status = p.status as string;
            const intent = getStatusIntent("project", status);
            const client = p.client as { name?: string } | null;
            const equipCount = (p._count as { lineItems?: number } | undefined)?.lineItems ?? 0;
            const dateLine = projectDateLine(p);
            return (
              <StaggerItem key={p.id as string}>
                <Link
                  href={`/projects/${p.id as string}`}
                  className={cn(
                    "block h-full rounded-lg border border-l-2 bg-bg-2/40 p-3 transition-colors hover:bg-bg-2",
                    intentBorder[intent] || "border-l-fg-3",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{p.name as string}</p>
                      <p className="truncate t-micro text-fg-3">
                        <span className="font-mono">{p.projectNumber as string}</span>
                        {client?.name ? <> · {client.name}</> : null}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-bg-3 px-2 py-0.5 text-[10px] font-medium text-fg-2">
                      {projectStatusLabels[status] || status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 t-micro text-fg-3">
                      <Boxes className="h-3 w-3" /> {equipCount} item{equipCount === 1 ? "" : "s"}
                    </span>
                    {dateLine && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 t-micro",
                          dateLine.tone === "error" && "text-error",
                          dateLine.tone === "warning" && "text-warning",
                          dateLine.tone === "muted" && "text-fg-3",
                        )}
                      >
                        <CalendarClock className="h-3 w-3" /> {dateLine.text}
                      </span>
                    )}
                  </div>
                </Link>
              </StaggerItem>
            );
          })}
        </StaggerList>
      )}

      {/* Needs attention */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="t-micro font-medium text-fg-3">Needs attention:</span>
        {chips.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> You&rsquo;re all caught up
          </span>
        ) : (
          chips.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                c.cls,
              )}
            >
              <c.Icon className="h-3.5 w-3.5" />
              {c.label}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
