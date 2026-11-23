"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CrewWorkspaceHead } from "@/components/crew/workspace/crew-workspace";
import { BulkBar, PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSegments, type ListPrimary } from "@/components/ui/list-page-parts";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import {
  byLastName,
  candidatesFor,
  localDayKey,
  memberMatches,
  memberName,
  openCallMatches,
  planSuggestedOffers,
  plannerFooter,
  stripCounts,
  weekDays,
  type OpenCall,
  type PlannerCall,
  type PlannerFilters,
  type PlannerMember,
} from "@/lib/crew-planner";
import type { ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import { buildCrewCallActions, buildOpenCallActions, buildPlannerBulkActions } from "@/lib/row-actions/crew-call";
import { useCanDo } from "@/lib/use-permissions";
import type { PlannerOfferValues } from "@/lib/validations/crew";
import { canCrewCall } from "../../../../../convex/lib/crewCallTransitions";
import { CallSheet, type OpenedCall } from "./call-sheet";
import { NeedsCrewList, openDay } from "./needs-crew-list";
import { OfferCallSheet, type OfferTarget } from "./offer-call-sheet";
import { PhonePlanner } from "./phone-day-list";
import { PlannerGrid, gridOrder, logisticsHref, type GridHandlers } from "./planner-grid";
import { PlannerToolbar, plannerFilterDefs } from "./planner-toolbar";
import { usePlannerData, type PlannerData } from "./use-planner-data";
import { usePlannerUrl, type PlannerUrl } from "./use-planner-url";
import { usePlannerWrites } from "./use-planner-writes";
import { useRangeSelection } from "./use-range-selection";

/**
 * Crew › Planner (UX Phase 15, spec §9h.2–9h.3, D46): one week, Mon–Sun, the
 * strip All · Needs crew · Unconfirmed · Mine, Role / Skill / Job /
 * Availability filters, all in the URL (the #1246 find-cover deep link
 * `?week&role&avail` still lands here). Click an empty cell to offer a call;
 * tick calls (shift for a range) for Offer n · Confirm n · Cancel n, or tick
 * open calls under Needs crew for Offer to suggested n.
 *
 * Keyed by the active org, so an org switch drops every selection.
 */
export function CrewPlanner() {
  const { data: activeOrg } = useActiveOrganization();
  return <CrewPlannerInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

interface Perms {
  create: boolean;
  update: boolean;
  remove: boolean;
}

function usePerms(): Perms {
  return { create: useCanDo("crew", "create"), update: useCanDo("crew", "update"), remove: useCanDo("crew", "delete") };
}

/** Who and which job a call is, for a toast that names a skipped row. */
function callNamer(members: PlannerMember[]) {
  const byCall = new Map<string, string>();
  for (const m of members) for (const c of m.assignments) byCall.set(c.id, `${memberName(m)} · ${c.project?.projectNumber ?? "call"}`);
  return (id: string) => byCall.get(id) ?? "a call";
}

/** The day Offer call (the primary) opens on: the first day with an open call, else today in this week, else Monday. */
function primaryDay(open: OpenCall[], week: string, days: string[], today: string): string {
  const first = open.map((o) => openDay(o, week)).sort()[0];
  return first ?? (days.includes(today) ? today : week);
}

const when = <F,>(ok: boolean, f: F): F | undefined => (ok ? f : undefined);

function CrewPlannerInner({ orgId }: { orgId: string | undefined }) {
  const now = useStableNow();
  const today = localDayKey(now);
  const url = usePlannerUrl(today);
  const data = usePlannerData(orgId, url.week);
  const { data: session } = useSession();
  const userId = session?.user.id;
  const perms = usePerms();
  const [offer, setOffer] = React.useState<OfferTarget | null>(null);
  const all = React.useMemo(() => data.members ?? [], [data.members]);
  const days = weekDays(url.week);
  const primary = when(perms.create, { label: "Offer call", onSelect: () => setOffer({ day: primaryDay(data.open, url.week, days, today) }) });
  return (
    <div className="space-y-4">
      <CrewWorkspaceHead view="planner" primary={primary} />
      <PlannerStrip url={url} data={data} userId={userId} />
      <PlannerToolbar url={url} defs={plannerFilterDefs(data.roles, data.skills, all, data.open)} />
      <PlannerBody key={`${url.week}:${url.state.seg}`} url={url} data={data} days={days} today={today} now={now} userId={userId} perms={perms} onOffer={setOffer} primary={primary} />
      <Footer members={data.members} week={url.week} />
      <OfferSheetHost target={offer} setTarget={setOffer} data={data} days={days} week={url.week} canDelete={perms.remove} />
    </div>
  );
}

function PlannerStrip({ url, data, userId }: { url: PlannerUrl; data: PlannerData; userId?: string }) {
  const counts = data.members ? stripCounts(data.members, data.open, url.week, userId) : undefined;
  const segs = [
    { key: "all", label: "All", count: counts?.all },
    { key: "needs", label: "Needs crew", count: counts?.needs },
    { key: "unconfirmed", label: "Unconfirmed", count: counts?.unconfirmed },
    { key: "mine", label: "Mine", count: counts?.mine },
  ];
  return <ListSegments segments={segs} value={url.state.seg} onChange={url.setSeg} />;
}

function Footer({ members, week }: { members: PlannerMember[] | undefined; week: string }) {
  if (!members) return null;
  const f = plannerFooter(members, week);
  return (
    <p className="text-caption text-muted" data-testid="planner-footer">
      {f.text}
      {f.declined > 0 && <span className="text-t-out"> · {f.declined} declined</span>}
    </p>
  );
}

function OfferSheetHost({ target, setTarget, data, days, week, canDelete }: {
  target: OfferTarget | null; setTarget: (t: OfferTarget | null) => void; data: PlannerData; days: string[]; week: string; canDelete: boolean;
}) {
  const members = data.members ?? [];
  const w = usePlannerWrites({ nameOf: callNamer(members), canDelete });
  const submit = async (v: PlannerOfferValues) => {
    const member = members.find((m) => m.id === v.memberId);
    const open = data.open.find((o) => o.serviceId === v.serviceId);
    if (!member || !open) return false;
    return await w.offerCall({ member, open, crewRoleId: v.crewRoleId, startTime: v.startTime ?? "", endTime: v.endTime ?? "", sendNow: v.sendNow });
  };
  return (
    <OfferCallSheet target={target} onOpenChange={(o) => !o && setTarget(null)} onSubmit={submit}
      members={members} open={data.open} roles={data.roles} days={days} week={week} />
  );
}

interface BodyProps {
  url: PlannerUrl;
  data: PlannerData;
  days: string[];
  today: string;
  now: number;
  userId?: string;
  perms: Perms;
  onOffer: (t: OfferTarget) => void;
  /** The head's primary; on a phone it is the sticky button instead. */
  primary?: ListPrimary;
}

function useShown(data: PlannerData, filters: PlannerFilters, week: string, userId?: string) {
  return React.useMemo(() => {
    const members = data.members ?? [];
    const ctx = { week, userId, skillName: data.skillName };
    return {
      members: members.filter((m) => memberMatches(m, filters, ctx)).sort(byLastName),
      open: data.open.filter((o) => openCallMatches(o, filters)),
    };
  }, [data, filters, week, userId]);
}

type Writes = ReturnType<typeof usePlannerWrites>;

/** The block ⋯, the Needs crew row ⋯ and "offer this open call to…", from the shared builders. */
function usePlannerMenus(p: BodyProps, all: PlannerMember[], w: Writes) {
  const router = useRouter();
  const callMenu = (c: PlannerCall, m: PlannerMember): ActionMenuSpec =>
    buildCrewCallActions(
      { status: c.status, title: `${memberName(m)} · ${c.project?.projectNumber ?? ""}` },
      {
        onOffer: when(p.perms.update, () => void w.offer([c.id])),
        onConfirm: when(p.perms.update, () => void w.confirm([c.id])),
        onOpenJob: c.project ? () => router.push(logisticsHref(c.project!.id)) : undefined,
        onOpenPerson: () => router.push(`/crew/${m.id}`),
        onCancel: when(p.perms.update, () => void w.cancel([c.id])),
      },
    );

  const offerTo = (o: OpenCall) => p.onOffer({ day: openDay(o, p.url.week), serviceId: o.serviceId, memberId: candidatesFor(o, all)[0]?.member.id });
  const openMenu = (o: OpenCall): ActionMenuSpec =>
    buildOpenCallActions({
      onOfferTo: when(p.perms.create, () => offerTo(o)),
      onOfferSuggested: when(p.perms.create && p.perms.update, () => void w.offerSuggested(planSuggestedOffers([o], all))),
      suggestedCount: planSuggestedOffers([o], all).offers.length,
      onOpenJob: () => router.push(logisticsHref(o.projectId)),
    });
  return { callMenu, openMenu, offerTo };
}

function StickyPrimary({ primary }: { primary: ListPrimary }) {
  return (
    <PinnedAboveBottomNav>
      <Button className="w-full" onClick={primary.onSelect}>
        {primary.label}
      </Button>
    </PinnedAboveBottomNav>
  );
}

function PlannerBody(p: BodyProps) {
  const all = p.data.members ?? [];
  const shown = useShown(p.data, p.url.filters, p.url.week, p.userId);
  const calls = useRangeSelection();
  const opens = useRangeSelection();
  const w = usePlannerWrites({ nameOf: callNamer(all), canDelete: p.perms.remove });
  const [opened, setOpened] = React.useState<OpenedCall | null>(null);
  const needs = p.url.state.seg === "needs";
  const isMobile = useIsMobile();
  const { callMenu, openMenu, offerTo } = usePlannerMenus(p, all, w);
  const order = gridOrder(shown.members, p.days);
  const handlers: GridHandlers = {
    selected: calls.ids,
    onToggle: (id, shift) => calls.toggle(id, order, shift),
    onToggleAll: (on) => calls.setAll(order, on),
    onOpenCall: (call, member) => setOpened({ call, member }),
    onOfferCell: when(p.perms.create, (m: PlannerMember, day: string) => p.onOffer({ memberId: m.id, day })),
    menuFor: callMenu,
  };
  const sel = needs ? opens : calls;
  const bulk = useBulk({ all, open: shown.open, calls: calls.ids, opens: opens.ids, needs, perms: p.perms, w, clear: sel.clear });
  const openOrder = shown.open.map((o) => o.serviceId);
  const onOpenOpen = (o: OpenCall) => p.perms.create && offerTo(o);
  const views = {
    phone: () => (
      <PhonePlanner
        members={shown.members} open={shown.open} days={p.days} week={p.url.week} today={p.today} now={p.now} needsOnly={needs}
        selected={calls.ids} onToggle={(id) => calls.toggle(id, order, false)} onOpenCall={handlers.onOpenCall}
        onOfferFree={handlers.onOfferCell} onOpenOpen={onOpenOpen} menuFor={callMenu} openMenuFor={openMenu}
      />
    ),
    needs: () => (
      <NeedsCrewList
        open={shown.open} members={all} week={p.url.week} selected={opens.ids}
        onToggle={(id, shift) => opens.toggle(id, openOrder, shift)} onToggleAll={(on) => opens.setAll(openOrder, on)}
        onOpen={onOpenOpen} menuFor={openMenu}
        empty={<NeedsEmpty filtered={hasFilters(p.url)} onClear={p.url.clear} />}
      />
    ),
    empty: () => <GridEmpty roster={all.length} onClear={p.url.clear} />,
    grid: () => (
      <PlannerGrid members={shown.members} days={p.days} week={p.url.week} today={p.today} now={p.now} filters={p.url.filters} userId={p.userId} logged={p.data.logged} order={order} h={handlers} />
    ),
    loading: () => <PlannerSkeleton />,
  };
  const view = viewKind(p.data.members === undefined, isMobile, needs, shown.members.length === 0);

  return (
    <>
      <div className="overflow-x-auto">{views[view]()}</div>
      <BulkBar selection={{ count: sel.count, clear: sel.clear }} actions={bulk} noun={needs ? "open call" : "call"} />
      {/* Phone: the sticky primary, replaced by the bulk bar while anything is ticked (§9h.6). */}
      {isMobile && p.primary && sel.count === 0 && <StickyPrimary primary={p.primary} />}
      <CallSheet opened={opened} spec={opened ? callMenu(opened.call, opened.member) : { items: [] }} now={p.now} onOpenChange={(o) => !o && setOpened(null)} />
    </>
  );
}

/** Which body the planner shows: loading, the phone day list, Needs crew, the grid, or the grid's empty state. */
function viewKind(loading: boolean, phone: boolean, needs: boolean, noPeople: boolean): "loading" | "phone" | "needs" | "empty" | "grid" {
  if (loading) return "loading";
  if (phone) return "phone";
  if (needs) return "needs";
  return noPeople ? "empty" : "grid";
}

const hasFilters = (url: PlannerUrl) => Object.keys(url.state.filters).length > 0 || !!url.state.q.trim();

function useBulk(a: {
  all: PlannerMember[]; open: OpenCall[]; calls: ReadonlySet<string>; opens: ReadonlySet<string>; needs: boolean; perms: Perms;
  w: ReturnType<typeof usePlannerWrites>; clear: () => void;
}): BulkAction[] {
  const statusById = new Map<string, string | null | undefined>();
  for (const m of a.all) for (const c of m.assignments) statusById.set(c.id, c.status);
  const ticked = a.needs ? [] : [...a.calls];
  const pick = (ok: (s: string | null | undefined) => boolean) => ticked.filter((id) => ok(statusById.get(id)));
  const plan = planSuggestedOffers(a.needs ? a.open.filter((o) => a.opens.has(o.serviceId)) : [], a.all);
  const after = (f: () => Promise<void>) => async () => {
    await f();
    a.clear();
  };
  return buildPlannerBulkActions(
    { statuses: ticked.map((id) => statusById.get(id)), suggested: plan.offers.length },
    {
      onOffer: when(a.perms.update, after(() => a.w.offer(pick((s) => (s ?? "PENDING") === "PENDING")))),
      onConfirm: when(a.perms.update, after(() => a.w.confirm(pick((s) => canCrewCall(s, "confirm"))))),
      onOfferSuggested: when(a.perms.create && a.perms.update, after(() => a.w.offerSuggested(plan))),
      onCancel: when(a.perms.update, after(() => a.w.cancel(pick((s) => canCrewCall(s, "cancel"))))),
    },
  );
}

function PlannerSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading the planner">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function GridEmpty({ roster, onClear }: { roster: number; onClear: () => void }) {
  if (roster === 0) {
    return (
      <EmptyState
        title="No crew on the roster yet"
        description="Add crew before you plan a week."
        action={<Link href="/crew" className="text-ui-text text-ink underline">Open the crew list</Link>}
      />
    );
  }
  return (
    <EmptyState
      title="No crew match that"
      description="Loosen a filter or clear them."
      action={<button type="button" onClick={onClear} className="text-ui-text text-ink underline">Clear filters</button>}
    />
  );
}

function NeedsEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  if (filtered) {
    return <EmptyState title="No open calls match that" description="Loosen a filter." action={<button type="button" onClick={onClear} className="text-ui-text text-ink underline">Clear filters</button>} />;
  }
  return <EmptyState title="Every call this week has crew" description="Nothing to fill. Step to next week with ›." />;
}
