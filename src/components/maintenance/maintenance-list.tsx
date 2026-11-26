"use client";

import { isOpenMaintenance } from "../../../convex/lib/maintenanceOpen";
import { CheckoffDialog } from "@/components/maintenance/checkoff-dialog";
import { MaintenanceSheetHost } from "@/components/maintenance/maintenance-sheet-host";
import { CompleteRecordDialog } from "@/components/maintenance/record/complete-record-dialog";
import { ServiceSchedulesDialog } from "@/components/maintenance/service-schedules-dialog";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { AssignDialog, RescheduleDialog } from "@/components/maintenance/maintenance-bulk-dialogs";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { useMemberRoster } from "@/hooks/use-member-roster";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  MAINTENANCE_COLUMNS,
  MAINTENANCE_ITEM_HEADER,
  MAINTENANCE_ITEM_SORT_KEY,
  MAINTENANCE_SPEC,
  maintenanceFilters,
  maintenanceQueryArgs,
  maintenanceRowOf,
  maintenanceSegments,
  type MaintenanceSource,
} from "@/lib/list-views/maintenance";
import { announceListWrite, plural } from "@/lib/list-write-toast";
import { buildMaintenanceActions, buildMaintenanceBulkActions, buildMaintenancePageMenu } from "@/lib/row-actions/maintenance";
import { showError } from "@/lib/show-error";
import { useCanDo } from "@/lib/use-permissions";

/** Keyed by org: the seen-row cache and the selection never leak across an org switch. */
export function MaintenanceList() {
  const { data: activeOrg } = useActiveOrganization();
  return <MaintenanceListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

/** `Rescheduled 3 records · 1 finished, left as it is`. */
function bulkTitle(verb: string, r: { count: number; skipped: number }): string {
  return `${verb} ${plural(r.count, "record")}${r.skipped > 0 ? ` · ${r.skipped} finished, left as ${r.skipped === 1 ? "it is" : "they are"}` : ""}`;
}

function MaintenanceListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(MAINTENANCE_SPEC);
  const canCreate = useCanDo("maintenance", "create");
  const canUpdate = useCanDo("maintenance", "update");
  const canDelete = useCanDo("maintenance", "delete");
  const writes = useMaintenanceWrites();
  const { options: members } = useMemberRoster(orgId);

  const page = useAuthedQuery(api.maintenanceList.listPage, orgId ? { orgId, ...maintenanceQueryArgs(state, now) } : "skip");
  const counts = useAuthedQuery(api.maintenanceList.segmentCounts, orgId ? { orgId, now } : "skip");
  const { data: items, total, isLoading } = usePaginatedTableResult(page as { items: MaintenanceSource[]; total: number; totalPages: number } | undefined);

  // Phone pages accumulate: handlers read the row at click time, from every row seen so far.
  const seen = React.useRef(new Map<string, MaintenanceSource>());
  React.useEffect(() => {
    for (const m of items) seen.current.set(m.id, m);
  }, [items]);

  const pathname = usePathname();
  const params = useSearchParams();
  const dialog = params.get("dialog");
  const [markingDone, setMarkingDone] = React.useState<string | null>(null);
  /** The two page dialogs live in the URL (`?dialog=checkoff|schedules`, `&record=` narrows Check off to one record). */
  const openDialog = (name: "checkoff" | "schedules", record?: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("dialog", name);
    if (record) q.set("record", record);
    else q.delete("record");
    router.push(`${pathname}?${q.toString()}`);
  };
  const closeDialog = () => {
    const q = new URLSearchParams(params.toString());
    q.delete("dialog");
    q.delete("record");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  const [rescheduling, setRescheduling] = React.useState<string[] | null>(null);
  const [assigning, setAssigning] = React.useState<string[] | null>(null);

  const openNew = () => router.push("/maintenance?new=1");
  useKeyboardShortcut("n", () => canCreate && openNew());

  /** ONE guarded Undo closure per bulk write (`announceListWrite`); the server refuses if any record changed since. */
  const announceBulk = (title: string, r: { count: number; auditIds: string[] }) => {
    if (r.count === 0) return void toast("Nothing changed");
    announceListWrite({ title, undoneTitle: "Change undone", performUndo: async () => void (await writes.undoBulkEdit(r.auditIds)) });
  };

  const reschedule = async (ms: number) => {
    try {
      const r = await writes.bulkReschedule(rescheduling ?? [], ms);
      announceBulk(bulkTitle("Rescheduled", r), r);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not reschedule" });
      throw e;
    }
  };

  const assign = async (userId: string | null) => {
    try {
      const r = await writes.bulkAssign(assigning ?? [], userId);
      announceBulk(bulkTitle(userId ? "Assigned" : "Unassigned", r), r);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not assign" });
      throw e;
    }
  };

  const remove = async (id: string, title: string) => {
    try {
      await writes.remove(id);
      toast.success(`Deleted ${title}`);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not delete the record" });
    }
  };

  const rows = items.map((m) =>
    maintenanceRowOf(
      m,
      buildMaintenanceActions({
        title: m.title,
        onOpen: () => router.push(`/maintenance/${m.id}`),
        onEdit: canUpdate ? () => router.push(`/maintenance/${m.id}?edit=1`) : undefined,
        onMarkDone: canUpdate && isOpenMaintenance(m.status) ? () => setMarkingDone(m.id) : undefined,
        onCheckOff: canUpdate && m.type === "PREVENTATIVE" && isOpenMaintenance(m.status) ? () => openDialog("checkoff", m.id) : undefined,
        onReschedule: canUpdate ? () => setRescheduling([m.id]) : undefined,
        onAssign: canUpdate ? () => setAssigning([m.id]) : undefined,
        onDelete: canDelete ? () => void remove(m.id, m.title) : undefined,
      }),
    ),
  );
  const primary: ListPrimary | undefined = canCreate ? { label: "Log maintenance", onSelect: openNew } : undefined;

  return (
    <>
      <ListPage
        spec={MAINTENANCE_SPEC}
        title="Maintenance"
        noun="records"
        bulkNoun="record"
        searchPlaceholder="Search title, asset tag or model"
        segments={maintenanceSegments(counts as Record<string, number | boolean> | undefined)}
        filters={maintenanceFilters()}
        columns={MAINTENANCE_COLUMNS}
        columnsKey="maintenance"
        rows={rows}
        total={total}
        loading={isLoading}
        itemHeader={MAINTENANCE_ITEM_HEADER}
        itemSortKey={MAINTENANCE_ITEM_SORT_KEY}
        primary={primary}
        pageMenu={buildMaintenancePageMenu({ onCheckoff: () => openDialog("checkoff"), onSchedules: () => openDialog("schedules") })}
        notice={(page as { truncated?: boolean } | undefined)?.truncated ? "Showing the first records only: narrow the list to see the rest." : undefined}
        bulk={(ids) =>
          buildMaintenanceBulkActions({
            onAssign: canUpdate ? () => setAssigning(ids) : undefined,
            onReschedule: canUpdate ? () => setRescheduling(ids) : undefined,
          })
        }
        empty={{ title: "No maintenance records", description: "Repairs, inspections and scheduled servicing appear here once you log them.", action: primary }}
        toolbarExtra={<UrlSavedViewsMenu tableId="maintenance" spec={MAINTENANCE_SPEC} state={state} setState={setState} />}
      />
      {canCreate && <MaintenanceSheetHost mode="new" />}
      <CheckoffDialog open={dialog === "checkoff"} onOpenChange={(o) => !o && closeDialog()} orgId={orgId} recordId={params.get("record")} />
      <ServiceSchedulesDialog open={dialog === "schedules"} onOpenChange={(o) => !o && closeDialog()} orgId={orgId} />
      <CompleteRecordDialog orgId={orgId} id={markingDone} open={!!markingDone} onOpenChange={(o) => !o && setMarkingDone(null)} />
      <RescheduleDialog count={rescheduling?.length ?? null} onClose={() => setRescheduling(null)} onSubmit={reschedule} />
      <AssignDialog count={assigning?.length ?? null} members={members} onClose={() => setAssigning(null)} onSubmit={assign} />
    </>
  );
}
