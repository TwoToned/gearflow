"use client";

import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { NATIVE_DASHBOARD_ENABLED, useNativeDashboardStats } from "@/hooks/use-native-dashboard";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  ScanBarcode,
  Zap,
  Wrench,
  ArrowRight,
  ShieldAlert,
  AtSign,
  AlertTriangle,
  UserCheck,
  Plus,
  Boxes,
} from "lucide-react";
import {
  FadeIn,
  StaggerList,
  StaggerItem,
  AnimatedNumber,
} from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { getStatusIntent } from "@/lib/status-colors";
import { cn, focusRing } from "@/lib/utils";
import {
  getDashboardStats,
  getUpcomingProjects,
  getRecentActivity,
  getMyHomeData,
  getMyBlockingComments,
} from "@/server/dashboard";
import { MyWorkSection } from "@/components/dashboard/my-work-section";
import { getSubHireDashboardStats } from "@/server/sub-hires";
import { formatDistanceToNow, format } from "date-fns";
import type { LucideIcon } from "lucide-react";

const DAY = 24 * 60 * 60 * 1000;
const LIVE_STATUSES = new Set(["CHECKED_OUT", "ON_SITE"]);

type Hue = "blue" | "amber" | "green" | "purple" | "coral" | "teal" | "red";
const hueDot: Record<Hue, string> = {
  blue: "bg-blue", amber: "bg-amber", green: "bg-green", purple: "bg-purple",
  coral: "bg-coral", teal: "bg-teal", red: "bg-red",
};
const hueText: Record<Hue, string> = {
  blue: "text-blue", amber: "text-amber", green: "text-green", purple: "text-purple",
  coral: "text-coral", teal: "text-teal", red: "text-red",
};

const TILE = "rounded-[var(--r-lg)] border border-line bg-card shadow-[var(--sh-card)]";
const TILE_LINK = `${TILE} ${focusRing} block transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--sh-hover)]`;

export default function DashboardPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Native read-layer path (Phase 3, default OFF). When the flag is on, the seven
  // dashboard stats come from the counter-backed dashboardStats.bundle subscription
  // (O(1) read + date-derived) instead of getDashboardStats' whole-org scans. Both
  // hooks run; the flag selects the result. When off, the native hook skips and the
  // server query stays enabled.
  const nativeStats = useNativeDashboardStats(orgId);
  const { data: scStats, isLoading: scStatsLoading } = useServerQuery({
    queryKey: ["dashboard-stats", orgId],
    queryFn: getDashboardStats,
    enabled: !NATIVE_DASHBOARD_ENABLED,
  });
  const stats = NATIVE_DASHBOARD_ENABLED ? nativeStats.data : scStats;
  const statsLoading = NATIVE_DASHBOARD_ENABLED ? nativeStats.isLoading : scStatsLoading;
  const { data: upcoming } = useServerQuery({ queryKey: ["dashboard-upcoming", orgId], queryFn: getUpcomingProjects });
  const { data: activity } = useServerQuery({ queryKey: ["dashboard-activity", orgId], queryFn: getRecentActivity });
  const { data: subHireStats } = useServerQuery({ queryKey: ["dashboard-sub-hire-stats", orgId], queryFn: getSubHireDashboardStats });
  const { data: myHome } = useServerQuery({ queryKey: ["my-home", orgId], queryFn: getMyHomeData });
  const { data: myBlockers } = useServerQuery({ queryKey: ["my-blocking-comments", orgId], queryFn: getMyBlockingComments });

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = myHome?.userName ? String(myHome.userName).split(" ")[0] : "";

  const myProjects = (myHome?.myProjects ?? []) as Record<string, unknown>[];
  const liveJobs = myProjects.filter((p) => LIVE_STATUSES.has(p.status as string));
  const activityItems = buildActivityTimeline(activity);

  const overdue = stats?.overdueReturns ?? 0;
  const deployed = stats?.checkedOutAssets ?? 0;
  const total = stats?.totalAssets ?? 0;
  const util = total > 0 ? Math.round((deployed / total) * 100) : 0;

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
      {/* ── Hero + quick actions ── */}
      <FadeIn>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="t-body text-muted">{format(now, "EEEE, d MMMM yyyy")}</p>
            {aside && (asideOverdue
              ? <p className="mt-1.5 text-ui-text font-medium text-t-out">{aside}</p>
              : <p className="mt-1.5 font-hand text-[15px] text-t-out">{aside}</p>)}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="halo"><Link href="/projects/new"><Plus className="h-4 w-4" /> New job</Link></Button>
            <Button asChild variant="line"><Link href="/warehouse"><ScanBarcode className="h-4 w-4" /> Warehouse</Link></Button>
            <Button asChild variant="line"><Link href="/assets/registry/new"><Boxes className="h-4 w-4" /> Add gear</Link></Button>
          </div>
        </div>
      </FadeIn>

      {/* ── Bento board ── */}
      <div className="grid auto-rows-[minmax(0,auto)] grid-cols-2 gap-3 lg:grid-cols-4">
        {/* On the floor now — hero tile */}
        <FadeIn delay={0.04} className="col-span-2 lg:row-span-2">
          <div className={`${TILE} flex h-full flex-col p-5`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {liveJobs.length > 0 && <LivePulse />}
                <h2 className="t-overline text-muted">On the floor now</h2>
              </div>
              {liveJobs.length > 0 && <span className="text-[11px] text-muted">{liveJobs.length} live</span>}
            </div>
            {!myHome ? (
              <div className="space-y-2"><Skeleton className="h-16 w-full rounded-[var(--r)]" /><Skeleton className="h-16 w-full rounded-[var(--r)]" /></div>
            ) : liveJobs.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <FlowMascot className="h-10 w-10" eyeColor="var(--ok)" />
                <p className="text-[14px] font-medium text-ink">Nothing out right now</p>
                <p className="t-micro text-muted">The warehouse is full and calm. Enjoy it.</p>
              </div>
            ) : (
              <StaggerList className="flex flex-col gap-2">
                {liveJobs.slice(0, 4).map((p) => (<StaggerItem key={p.id as string}><LiveJobRow project={p} now={now} /></StaggerItem>))}
              </StaggerList>
            )}
          </div>
        </FadeIn>

        {/* Stat tiles */}
        <StatTile label="Active jobs" value={stats?.activeProjects} loading={statsLoading} hue="blue" sub="in flight" href="/projects" />
        <StatTile label="Overdue returns" value={overdue} loading={statsLoading} hue="red" sub={overdue > 0 ? "chase them" : "all back"} href="/projects" problem={overdue > 0} />
        <DeployTile deployed={deployed} total={total} util={util} loading={statsLoading} />
        <StatTile label="Crew booked" value={stats?.activeCrew} loading={statsLoading} hue="purple" sub="on the books" href="/crew" />

        {/* Needs attention */}
        <FadeIn delay={0.08} className="col-span-2">
          <div className={`${TILE} h-full p-5`}>
            <h2 className="t-overline mb-3 text-muted">Needs attention</h2>
            <NeedsAttention stats={stats} loading={statsLoading} blockers={myBlockers ?? []} subHireOverdue={subHireStats?.overdueReturns ?? 0} />
          </div>
        </FadeIn>

        {/* Upcoming */}
        <FadeIn delay={0.1} className="col-span-2">
          <div className={`${TILE} h-full p-5`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="t-overline text-muted">Upcoming</h2>
              <Link href="/projects" className={cn("inline-flex items-center gap-1 rounded-[var(--r)] text-[11px] text-muted hover:text-ink", focusRing)}>All <ArrowRight className="h-3 w-3" /></Link>
            </div>
            {!upcoming ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : upcoming.length === 0 ? (
              <p className="t-body text-muted">Nothing booked ahead. Quote something.</p>
            ) : (
              <StaggerList className="space-y-1">
                {(upcoming as Record<string, unknown>[]).slice(0, 4).map((p) => {
                  const client = p.client as { name?: string } | null;
                  const start = p.rentalStartDate ? new Date(p.rentalStartDate as string) : null;
                  const intent = getStatusIntent("project", p.status as string);
                  return (
                    <StaggerItem key={p.id as string}>
                      <Link href={`/projects/${p.id}`} className={cn("group flex items-center justify-between gap-3 rounded-[var(--r)] px-2 py-2 transition-colors hover:bg-elev", focusRing)}>
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-medium text-ink">{p.name as string}</p>
                          <p className="t-micro truncate text-muted"><span className="font-mono">{p.projectNumber as string}</span>{client?.name ? <> · {client.name}</> : null}</p>
                        </div>
                        {start && (
                          <span className={`shrink-0 text-[11px] font-medium ${hueText[intent === "primary" ? "red" : (intent as Hue)] ?? "text-muted"}`}>
                            {format(start, "MMM d")}
                          </span>
                        )}
                      </Link>
                    </StaggerItem>
                  );
                })}
              </StaggerList>
            )}
          </div>
        </FadeIn>

        {/* Recent activity — full width */}
        <FadeIn delay={0.12} className="col-span-2 lg:col-span-4">
          <div className={`${TILE} p-5`}>
            <h2 className="t-overline mb-4 text-muted">Recent activity</h2>
            {!activity ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : activityItems.length === 0 ? (
              <p className="t-body text-muted">Quiet so far. Scan some gear and it&rsquo;ll show up here.</p>
            ) : (
              <StaggerList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activityItems.map((item) => (<StaggerItem key={item.key}><ActivityItem item={item} /></StaggerItem>))}
              </StaggerList>
            )}
          </div>
        </FadeIn>
      </div>

      {/* ── Blockers (alert context — plain, no personality) ── */}
      {myBlockers && myBlockers.length > 0 && (
        <FadeIn delay={0.14}>
          <div className="rounded-[var(--r-lg)] border border-line border-l-[3px] border-l-t-out bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-t-out" />
              <h2 className="text-card-title font-semibold text-ink">Blockers needing you</h2>
              <span className="rounded-full bg-out-soft px-1.5 py-0.5 text-[11px] font-medium text-t-out">{myBlockers.length}</span>
            </div>
            <StaggerList className="space-y-1">
              {myBlockers.map((b: Record<string, unknown>) => (
                <StaggerItem key={b.threadId as string}>
                  <Link href={`/projects/${b.projectId}`} className={cn("group block rounded-[var(--r)] px-3 py-2.5 transition-colors hover:bg-out-soft", focusRing)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-muted">{b.projectNumber as string}</span>
                          <span className="truncate text-[14px] font-medium text-ink">{b.projectName as string}</span>
                          {b.reason === "mention" && (<span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-out-soft px-1.5 py-0.5 text-[11px] text-t-out"><AtSign className="h-2.5 w-2.5" /> mentioned</span>)}
                        </div>
                        {b.snippet ? <p className="mt-0.5 truncate text-[12px] text-muted">&ldquo;{b.snippet as string}&rdquo;</p> : null}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted">{b.createdByName as string} &middot; {formatDistanceToNow(new Date(b.createdAt as number), { addSuffix: true })}</span>
                    </div>
                  </Link>
                </StaggerItem>
              ))}
            </StaggerList>
          </div>
        </FadeIn>
      )}

      {/* ── Your jobs ── */}
      <FadeIn delay={0.16}><MyWorkSection projects={myProjects} blockers={(myBlockers ?? []) as Record<string, unknown>[]} /></FadeIn>
    </div>
  );
}

// ─── Tiles ─────────────────────────────────────────────────────

function StatTile({ label, value, loading, hue, sub, href, problem = false }: { label: string; value: number | undefined; loading: boolean; hue: Hue; sub: string; href: string; problem?: boolean }) {
  return (
    <FadeIn delay={0.05}>
      <Link href={href} className={`${TILE_LINK} h-full p-5`}>
        <div className="flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${hueDot[hue]}`} aria-hidden />
          <span className="t-overline text-muted">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-9 w-14" />
        ) : (
          <p className={`mt-1 font-display text-[38px] font-extrabold leading-none tracking-tight tabular-nums ${problem && value ? "text-t-out" : "text-ink"}`}>
            {typeof value === "number" ? <AnimatedNumber value={value} /> : <span className="text-faint">&mdash;</span>}
          </p>
        )}
        <p className="mt-1.5 t-micro text-faint">{sub}</p>
      </Link>
    </FadeIn>
  );
}

function DeployTile({ deployed, total, util, loading }: { deployed: number; total: number; util: number; loading: boolean }) {
  const meterHue = util >= 85 ? "bg-t-out" : util >= 60 ? "bg-warn" : "bg-amber";
  return (
    <FadeIn delay={0.05}>
      <Link href="/assets/registry" className={`${TILE_LINK} h-full p-5`}>
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-amber" aria-hidden />
          <span className="t-overline text-muted">Gear deployed</span>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-9 w-14" />
        ) : (
          <p className="mt-1 font-display text-[38px] font-extrabold leading-none tracking-tight tabular-nums text-ink"><AnimatedNumber value={deployed} /></p>
        )}
        {/* Utilisation meter (not a chart — a fill bar) */}
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-elev">
          <div className={`h-full rounded-full ${meterHue} transition-all`} style={{ width: `${Math.min(util, 100)}%` }} />
        </div>
        <p className="mt-1.5 t-micro text-faint">{util}% of {total} out</p>
      </Link>
    </FadeIn>
  );
}

function NeedsAttention({ stats, loading, blockers, subHireOverdue }: { stats?: { overdueReturns?: number; maintenanceDue?: number; pendingCrewOffers?: number }; loading: boolean; blockers: Record<string, unknown>[]; subHireOverdue: number }) {
  if (loading) return <div className="flex gap-2"><Skeleton className="h-8 w-36 rounded-full" /><Skeleton className="h-8 w-28 rounded-full" /></div>;
  const chips = [
    blockers.length > 0 && { href: `/projects/${blockers[0].projectId}`, label: `${blockers.length} blocker${blockers.length > 1 ? "s" : ""} need you`, cls: "bg-out-soft text-t-out hover:bg-out-soft/70", Icon: ShieldAlert },
    (stats?.overdueReturns ?? 0) > 0 && { href: "/projects", label: `${stats?.overdueReturns} overdue return${(stats?.overdueReturns ?? 0) > 1 ? "s" : ""}`, cls: "bg-out-soft text-t-out hover:bg-out-soft/70", Icon: AlertTriangle },
    subHireOverdue > 0 && { href: "/suppliers", label: `${subHireOverdue} sub-hire overdue`, cls: "bg-out-soft text-t-out hover:bg-out-soft/70", Icon: AlertTriangle },
    (stats?.maintenanceDue ?? 0) > 0 && { href: "/maintenance", label: `${stats?.maintenanceDue} maintenance due`, cls: "bg-warn-soft text-warn hover:bg-warn-soft/70", Icon: Wrench },
    (stats?.pendingCrewOffers ?? 0) > 0 && { href: "/crew", label: `${stats?.pendingCrewOffers} crew offer${(stats?.pendingCrewOffers ?? 0) > 1 ? "s" : ""} pending`, cls: "bg-blue-soft text-blue hover:bg-blue-soft/70", Icon: UserCheck },
  ].filter(Boolean) as { href: string; label: string; cls: string; Icon: LucideIcon }[];

  if (chips.length === 0) {
    return (
      <div className="flex items-center gap-3 py-1">
        <FlowMascot className="h-9 w-9 shrink-0" eyeColor="var(--ok)" />
        <div>
          <p className="text-[14px] font-medium text-ink">All clear.</p>
          <p className="t-micro text-muted">No overdue returns, no clashes, nothing waiting on you. Frame it.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link key={c.label} href={c.href} className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-table-cell font-medium shadow-[var(--sh-stk)] transition-colors", focusRing, c.cls)}>
          <c.Icon className="h-4 w-4" /> {c.label}
        </Link>
      ))}
    </div>
  );
}

// ─── Live job ──────────────────────────────────────────────────

function LivePulse() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-ok opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
    </span>
  );
}

function LiveJobRow({ project, now }: { project: Record<string, unknown>; now: Date }) {
  const client = project.client as { name?: string } | null;
  const end = project.rentalEndDate ? new Date(project.rentalEndDate as string) : null;
  const itemCount = (project._count as { lineItems?: number } | undefined)?.lineItems ?? 0;
  let back = "";
  if (end) {
    const days = Math.round((end.getTime() - now.getTime()) / DAY);
    back = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "back today" : `back in ${days}d`;
  }
  const overdue = back.includes("overdue");
  return (
    <Link href={`/projects/${project.id}`} className={cn("group block rounded-[var(--r)] border border-line bg-elev p-3 shadow-[var(--lit)] transition-all motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--sh-card),var(--lit)]", focusRing)}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[14px] font-semibold text-ink">{project.name as string}</p>
        <span className={`shrink-0 text-[11px] font-medium ${overdue ? "text-t-out" : "text-muted"}`}>{back}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1 text-ok"><LivePulse /> On site</span>
        <span>·</span>
        <span className="font-mono">{project.projectNumber as string}</span>
        {client?.name ? <><span>·</span><span className="truncate">{client.name}</span></> : null}
        <span>·</span>
        <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
      </div>
    </Link>
  );
}

// ─── Activity timeline ─────────────────────────────────────────

interface TimelineItem { key: string; type: "scan" | "test" | "maintenance"; time: Date; data: Record<string, unknown>; }

function buildActivityTimeline(activity: Record<string, unknown> | undefined): TimelineItem[] {
  if (!activity) return [];
  const logs = activity.logs as Record<string, unknown>[] | undefined;
  const testRecords = activity.testRecords as Record<string, unknown>[] | undefined;
  const maintRecords = activity.maintenanceRecords as Record<string, unknown>[] | undefined;
  const items: TimelineItem[] = [];
  for (const log of logs || []) items.push({ key: `scan-${log.id}`, type: "scan", time: new Date(log.scannedAt as string), data: log });
  for (const rec of testRecords || []) items.push({ key: `test-${rec.id}`, type: "test", time: new Date(rec.testDate as string), data: rec });
  for (const mr of maintRecords || []) items.push({ key: `maint-${mr.id}`, type: "maintenance", time: new Date(mr.updatedAt as string), data: mr });
  items.sort((a, b) => b.time.getTime() - a.time.getTime());
  return items.slice(0, 9);
}

function ActivityItem({ item }: { item: TimelineItem }) {
  if (item.type === "scan") {
    const log = item.data;
    const asset = log.asset as Record<string, unknown> | null;
    const bulkAsset = log.bulkAsset as Record<string, unknown> | null;
    const project = log.project as Record<string, unknown> | null;
    const user = log.scannedBy as Record<string, unknown> | null;
    const model = asset ? (asset.model as Record<string, unknown>) : bulkAsset ? (bulkAsset.model as Record<string, unknown>) : null;
    const isCheckOut = log.action === "CHECK_OUT";
    return (
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-green-soft text-green"><ScanBarcode className="h-3.5 w-3.5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug text-ink"><span className="font-medium">{(model?.name as string) || "Asset"}</span> <span className="text-muted">{isCheckOut ? "deployed to" : "returned from"}</span> {project ? <Link href={`/projects/${project.id}`} className="font-medium hover:underline">{project.name as string}</Link> : <span className="text-muted">unknown project</span>}</p>
          <p className="mt-0.5 text-[11px] text-muted">{(user?.name as string) || "Unknown"} &middot; {formatDistanceToNow(item.time, { addSuffix: true })}</p>
        </div>
      </div>
    );
  }
  if (item.type === "test") {
    const rec = item.data;
    const ttAsset = rec.testTagAsset as Record<string, unknown> | null;
    const tester = rec.testedBy as Record<string, unknown> | null;
    const result = rec.result as string;
    const resultColor = result === "PASS" ? "text-ok" : result === "FAIL" ? "text-t-out" : "text-warn";
    return (
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal"><Zap className="h-3.5 w-3.5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug text-ink"><span className="font-medium">{(ttAsset?.description as string) || (ttAsset?.testTagId as string) || "Item"}</span> <span className="text-muted">tested &mdash;</span> <span className={`font-medium ${resultColor}`}>{result}</span></p>
          <p className="mt-0.5 text-[11px] text-muted">{(tester?.name as string) || "Unknown"} &middot; {formatDistanceToNow(item.time, { addSuffix: true })}</p>
        </div>
      </div>
    );
  }
  const mr = item.data;
  const mrAssets = (mr.assets as Record<string, unknown>[]) || [];
  const firstAsset = mrAssets[0]?.asset as Record<string, unknown> | undefined;
  const firstModel = firstAsset?.model as Record<string, unknown> | undefined;
  const reporter = mr.reportedBy as Record<string, unknown> | null;
  const mrStatus = mr.status as string;
  const mrStatusColor = mrStatus === "COMPLETED" ? "text-ok" : mrStatus === "IN_PROGRESS" ? "text-warn" : "text-blue";
  const mrStatusLabel: Record<string, string> = { SCHEDULED: "scheduled", IN_PROGRESS: "in progress", COMPLETED: "completed", CANCELLED: "cancelled" };
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-coral-soft text-coral"><Wrench className="h-3.5 w-3.5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug text-ink"><Link href={`/maintenance/${mr.id}`} className="font-medium hover:underline">{mr.title as string}</Link> <span className="text-muted">&mdash;</span> <span className={`font-medium ${mrStatusColor}`}>{mrStatusLabel[mrStatus] || mrStatus}</span></p>
        <p className="mt-0.5 truncate text-[11px] text-muted">{firstModel ? `${firstAsset?.assetTag as string} ${firstModel.name as string}` : ""}{mrAssets.length > 1 ? ` + ${mrAssets.length - 1} more` : ""}</p>
        <p className="text-[11px] text-muted">{(reporter?.name as string) || "Unknown"} &middot; {formatDistanceToNow(item.time, { addSuffix: true })}</p>
      </div>
    </div>
  );
}
