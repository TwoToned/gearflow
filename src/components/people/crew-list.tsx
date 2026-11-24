"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConvex, useConvexAuth } from "convex/react";
import { CalendarDays, Clock, Download, Settings2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { canCrewCall } from "../../../convex/lib/crewCallTransitions";

import { AssignToJobDialog } from "@/components/people/assign-to-job-dialog";
import { PeopleList, type PeopleListModel } from "@/components/people/people-list";
import { useCrewListWrites } from "@/components/people/use-people-writes";
import { ExportDialog } from "@/components/crew/workspace/timesheets/export-dialog";
import { TagPromptDialog } from "@/components/ui/tag-prompt-dialog";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  CREW_ITEM_HEADER,
  CREW_ITEM_SORT_KEY,
  CREW_SPEC,
  crewBuiltInViews,
  crewColumns,
  crewFilters,
  crewQueryArgs,
  crewRowOf,
  crewSegments,
  type CrewSource,
} from "@/lib/list-views/people";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { crewBulkActions, crewMemberActions, when } from "@/lib/row-actions/people";
import { useCanDo } from "@/lib/use-permissions";
import { sendCrewOffer } from "@/server/crew-communication";

/** Crew list (spec §9f.2, D38/D40): the landing page is the list; the manager dashboard is dissolved. */
export function CrewList() {
  const { data: activeOrg } = useActiveOrganization();
  return <CrewListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function useCrewListData(orgId: string | undefined) {
  const now = useStableNow();
  const { state, setState } = useListUrlState(CREW_SPEC);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const page = useAuthedQuery(api.peopleLists.crewPage, orgId ? { orgId, ...crewQueryArgs(state, now) } : "skip");
  const counts = useAuthedQuery(api.peopleLists.crewSegmentCounts, orgId ? { orgId, now } : "skip") as Record<string, number> | undefined;
  const roles = useAuthedQuery(api.crewRoles.list, orgId ? { orgId } : "skip");
  // Linked platform user's name and photo are cross-domain (Better Auth): merged in, as the old table did.
  const { data: extras } = useServerQuery({
    queryKey: ["crew-member-extras", orgId, isAuthenticated],
    queryFn: () => convex.query(api.crew.memberExtras, { orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });
  const items = React.useMemo(
    () =>
      ((page?.items ?? []) as unknown as CrewSource[]).map((m) => {
        const x = extras?.[m.id];
        return { ...m, user: x?.userName || x?.userImage ? { name: x.userName, image: x.userImage } : null };
      }),
    [page, extras],
  );
  return { now, state, setState, page, counts, roles: (roles ?? []) as { id: string; name: string; department?: string | null }[], items };
}

/** Everything the page ⋯ offers; `Log time…` is the one verb a read-only role does not get. */
function crewPageMenu(push: (href: string) => void, toApprove: number, canUpdate: boolean, openExport: () => void): ActionMenuSpec {
  const timesheets = toApprove > 0 ? `Timesheets · ${toApprove} to approve` : "Timesheets";
  return {
    items: [
      { key: "timesheets", label: timesheets, group: "organise", icon: Clock, onSelect: () => push("/crew/timesheets") },
      { key: "planner", label: "Planner", group: "organise", icon: CalendarDays, onSelect: () => push("/crew/planner") },
      { key: "roles", label: "Crew roles & rates…", group: "organise", icon: Settings2, onSelect: () => push("/crew/planner?sheet=roles") },
      ...(canUpdate ? [{ key: "log-time", label: "Log time…", group: "reporting" as const, icon: UserPlus, onSelect: () => push("/crew/timesheets") }] : []),
      { key: "export", label: "Export timesheets…", group: "reporting", icon: Download, onSelect: openExport },
    ],
  };
}

/** The dissolved dashboard's `Timesheets need approval` stat lives on as the page ⋯ count (managers only). */
function useTimesheetsToApprove(orgId: string | undefined, canUpdate: boolean, now: number): number {
  const stats = useAuthedQuery(api.crewDashboard.stats, orgId && canUpdate ? { orgId, nowMs: now } : "skip");
  return stats?.submittedTime ?? 0;
}

interface CrewRowHandlers {
  push: (href: string) => void;
  canUpdate: boolean;
  message: (id: string) => void;
  assign: (id: string) => void;
  resend: (callId: string) => void;
  deactivate: (id: string) => void;
  reactivate: (id: string) => void;
}

/** The row ⋯ per member: a verb the role may not do is ABSENT; `Resend offer` only for a call that can be offered. */
function crewRows(items: CrewSource[], h: CrewRowHandlers) {
  return items.map((m) => {
    const resendId = m.next && canCrewCall(m.next.status, "offer") ? m.next.callId : undefined;
    return crewRowOf(
      m,
      crewMemberActions(
        { name: m.firstName, listStatus: m.listStatus, hasEmail: !!m.email },
        {
          onOpen: () => h.push(`/crew/${m.id}`),
          onOpenInPlanner: () => h.push("/crew/planner"),
          onMessage: when(h.canUpdate, () => h.message(m.id)),
          onAssign: when(h.canUpdate, () => h.assign(m.id)),
          onResendOffer: when(h.canUpdate && !!resendId, () => h.resend(resendId!)),
          onLogTime: when(h.canUpdate, () => h.push("/crew/timesheets")),
          onDeactivate: when(h.canUpdate, () => h.deactivate(m.id)),
          onReactivate: when(h.canUpdate, () => h.reactivate(m.id)),
        },
      ),
    );
  });
}

/** What the page tells ListPage about the query: totals, loading, and the incomplete-counts note. */
function pageFlow(page: { total: number; payVisible?: boolean } | undefined, counts: Record<string, number> | undefined) {
  return { total: page?.total ?? 0, loading: page === undefined, subline: counts?.truncated ? "Counts may be incomplete" : undefined };
}

const departmentsOf =(roles: { department?: string | null }[], items: CrewSource[]): string[] =>
  [...new Set([...roles.map((r) => r.department), ...items.map((m) => m.department)].filter((x): x is string => !!x))].sort();

function CrewListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const d = useCrewListData(orgId);
  const canCreate = useCanDo("crew", "create");
  const canUpdate = useCanDo("crew", "update");
  const toApprove = useTimesheetsToApprove(orgId, canUpdate, d.now);

  const seen = React.useRef(new Map<string, CrewSource>());
  React.useEffect(() => {
    for (const m of d.items) seen.current.set(m.id, m);
  }, [d.items]);
  const w = useCrewListWrites(orgId, seen);
  const [tagIds, setTagIds] = React.useState<string[] | null>(null);
  const [assignIds, setAssignIds] = React.useState<string[] | null>(null);
  const [exportOpen, setExportOpen] = React.useState(false);
  const resend = useServerMutation({
    mutationFn: (callId: string) => sendCrewOffer(callId),
    onSuccess: () => toast.success("Offer sent"),
    onError: (e) => toast.error(e.message),
  });

  const rows = crewRows(d.items, {
    push: router.push,
    canUpdate,
    message: (id) => w.message([id]),
    assign: (id) => setAssignIds([id]),
    resend: (callId) => resend.mutate(callId),
    deactivate: (id) => void w.bulkDeactivate([id]),
    reactivate: (id) => void w.reactivateOne(id),
  });

  const goNew = () => router.push("/crew/new");
  const primary = canCreate ? { label: "New crew member", onSelect: goNew } : undefined;
  const model: PeopleListModel = {
    key: "crew",
    spec: CREW_SPEC,
    title: "Crew",
    noun: "crew",
    bulkNoun: "crew member",
    searchPlaceholder: "Search name, role, skill or tag",
    segments: crewSegments(d.counts),
    filters: crewFilters(d.roles, departmentsOf(d.roles, d.items)),
    columnsKey: "crew",
    columns: crewColumns(d.page?.payVisible === true),
    rows,
    ...pageFlow(d.page, d.counts),
    itemHeader: CREW_ITEM_HEADER,
    itemSortKey: CREW_ITEM_SORT_KEY,
    primary,
    pageMenu: crewPageMenu(router.push, toApprove, canUpdate, () => setExportOpen(true)),
    bulk: canUpdate ? (ids) => crewBulkActions({ onMessage: () => w.message(ids), onAssign: () => setAssignIds(ids), onAddTag: () => setTagIds(ids), onDeactivate: () => void w.bulkDeactivate(ids) }) : undefined,
    empty: { title: "No crew yet", description: "Freelancers, employees and contractors on your roster appear here.", action: primary },
    toolbarExtra: <UrlSavedViewsMenu tableId="crew" spec={CREW_SPEC} state={d.state} setState={d.setState} builtIns={crewBuiltInViews()} />,
  };

  return (
    <PeopleList model={model}>
      <TagPromptDialog open={tagIds !== null} onOpenChange={(o) => !o && setTagIds(null)} count={tagIds?.length ?? 0} noun="crew member" onSubmit={(tag) => tagIds && void w.bulkTag(tagIds, tag)} />
      <AssignToJobDialog
        open={assignIds !== null}
        onOpenChange={(o) => !o && setAssignIds(null)}
        orgId={orgId}
        count={assignIds?.length ?? 0}
        onPick={(job) => assignIds && void w.assign(assignIds, job)}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </PeopleList>
  );
}
