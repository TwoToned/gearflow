"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useConvex, useConvexAuth } from "convex/react";
import { Clock, Download, Settings2, CalendarDays, UserPlus } from "lucide-react";

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
import { crewBulkActions, crewMemberActions } from "@/lib/row-actions/people";
import { useCanDo } from "@/lib/use-permissions";
import { sendCrewOffer } from "@/server/crew-communication";
import { toast } from "sonner";

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

function CrewListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const d = useCrewListData(orgId);
  const canCreate = useCanDo("crew", "create");
  const canUpdate = useCanDo("crew", "update");
  // The dissolved dashboard's `Timesheets need approval` stat lives on as a page ⋯ count.
  const stats = useAuthedQuery(api.crewDashboard.stats, orgId && canUpdate ? { orgId, nowMs: d.now } : "skip");
  const toApprove = stats?.submittedTime ?? 0;

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

  const payVisible = d.page?.payVisible === true;
  const rows = d.items.map((m) => {
    const callId = m.next && canCrewCall(m.next.status, "offer") ? m.next.callId : undefined;
    const menu = crewMemberActions(
      { name: m.firstName, listStatus: m.listStatus, hasEmail: !!m.email },
      {
        onOpen: () => router.push(`/crew/${m.id}`),
        onOpenInPlanner: () => router.push("/crew/planner"),
        onMessage: canUpdate ? () => w.message([m.id]) : undefined,
        onAssign: canUpdate ? () => setAssignIds([m.id]) : undefined,
        onResendOffer: canUpdate && callId ? () => resend.mutate(callId) : undefined,
        onLogTime: canUpdate ? () => router.push("/crew/timesheets") : undefined,
        onDeactivate: canUpdate ? () => void w.bulkDeactivate([m.id]) : undefined,
        onReactivate: canUpdate ? () => void w.reactivateOne(m.id) : undefined,
      },
    );
    return crewRowOf(m, menu);
  });

  const departments = [...new Set([...d.roles.map((r) => r.department), ...d.items.map((m) => m.department)].filter((x): x is string => !!x))].sort();
  const pageMenu: ActionMenuSpec = {
    items: [
      { key: "timesheets", label: toApprove > 0 ? `Timesheets · ${toApprove} to approve` : "Timesheets", group: "organise", icon: Clock, onSelect: () => router.push("/crew/timesheets") },
      { key: "planner", label: "Planner", group: "organise", icon: CalendarDays, onSelect: () => router.push("/crew/planner") },
      { key: "roles", label: "Crew roles & rates…", group: "organise", icon: Settings2, onSelect: () => router.push("/crew/planner?sheet=roles") },
      ...(canUpdate ? [{ key: "log-time", label: "Log time…", group: "reporting" as const, icon: UserPlus, onSelect: () => router.push("/crew/timesheets") }] : []),
      { key: "export", label: "Export timesheets…", group: "reporting", icon: Download, onSelect: () => setExportOpen(true) },
    ],
  };

  const model: PeopleListModel = {
    key: "crew",
    spec: CREW_SPEC,
    title: "Crew",
    noun: "crew",
    bulkNoun: "crew member",
    searchPlaceholder: "Search name, role, skill or tag",
    segments: crewSegments(d.counts),
    filters: crewFilters(d.roles, departments),
    columnsKey: "crew",
    columns: crewColumns(payVisible),
    rows,
    total: d.page?.total ?? 0,
    loading: d.page === undefined,
    itemHeader: CREW_ITEM_HEADER,
    itemSortKey: CREW_ITEM_SORT_KEY,
    primary: canCreate ? { label: "New crew member", onSelect: () => router.push("/crew/new") } : undefined,
    pageMenu,
    subline: d.counts?.truncated ? "Counts may be incomplete" : undefined,
    bulk: canUpdate
      ? (ids) => crewBulkActions({ onMessage: () => w.message(ids), onAssign: () => setAssignIds(ids), onAddTag: () => setTagIds(ids), onDeactivate: () => void w.bulkDeactivate(ids) })
      : undefined,
    empty: { title: "No crew yet", description: "Freelancers, employees and contractors on your roster appear here.", action: canCreate ? { label: "New crew member", onSelect: () => router.push("/crew/new") } : undefined },
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
