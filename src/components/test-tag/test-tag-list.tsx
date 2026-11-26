"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { PrintTagsDialog } from "@/components/test-tag/print-tags-dialog";
import { ReportsDialog } from "@/components/test-tag/reports-dialog";
import { ScheduleTestDialog } from "@/components/test-tag/schedule-test-dialog";
import { ListPage } from "@/components/ui/list-page";
import type { ListPrimary } from "@/components/ui/list-page-parts";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useOrganization } from "@/hooks/use-organization";
import { usePaginatedTableResult } from "@/hooks/use-paginated-table-result";
import { useStableNow } from "@/hooks/use-stable-now";
import { useTestProfiles } from "@/hooks/use-test-profiles";
import { useTestTagWrites } from "@/hooks/use-test-tag-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  TEST_TAG_COLUMNS,
  TEST_TAG_ITEM_HEADER,
  TEST_TAG_ITEM_SORT_KEY,
  TEST_TAG_SPEC,
  testTagFilters,
  testTagQueryArgs,
  testTagRowOf,
  testTagSegments,
  type TestTagSource,
} from "@/lib/list-views/test-tag";
import { announceListWrite } from "@/lib/list-write-toast";
import { buildTestTagActions, buildTestTagBulkActions, buildTestTagPageMenu } from "@/lib/row-actions/test-tag";
import { showError } from "@/lib/show-error";
import type { ScheduleItem } from "@/lib/test-tag-schedule";
import { itemHistoryReportUrl } from "@/lib/test-tag-reports";
import { useCanDo } from "@/lib/use-permissions";
import type { OrgSettings } from "@/lib/org-settings-types";

/** Keyed by org: the seen-row cache and the selection never leak across an org switch. */
export function TestTagList() {
  const { data: activeOrg } = useActiveOrganization();
  return <TestTagListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

function TestTagListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const now = useStableNow();
  const { state, setState } = useListUrlState(TEST_TAG_SPEC);
  const canCreate = useCanDo("testTag", "create");
  const canUpdate = useCanDo("testTag", "update");
  const canSchedule = useCanDo("maintenance", "create");
  const canReport = useCanDo("reports", "view");
  const writes = useTestTagWrites();
  const profiles = useTestProfiles(orgId);
  // The org's own due-soon horizon (Settings › Test & tag); absent = the server's default of 14 days.
  const { data: org } = useOrganization(orgId);
  const dueSoonDays = ((org as { settings?: OrgSettings } | null | undefined)?.settings?.testTag?.dueSoonThresholdDays) || undefined;

  const page = useAuthedQuery(api.testTagList.listPage, orgId ? { orgId, ...testTagQueryArgs(state, now, dueSoonDays) } : "skip");
  const counts = useAuthedQuery(api.testTagList.segmentCounts, orgId ? { orgId, now, dueSoonDays } : "skip");
  const { data: items, total, isLoading } = usePaginatedTableResult(page as { items: TestTagSource[]; total: number; totalPages: number } | undefined);

  const pathname = usePathname();
  const params = useSearchParams();
  /** Reports is a page dialog in the URL (`?dialog=reports`), so the old link and the nav sub-row land on it. */
  const reportsOpen = canReport && params.get("dialog") === "reports";
  const setReportsOpen = (open: boolean) => {
    const q = new URLSearchParams(params.toString());
    if (open) q.set("dialog", "reports");
    else q.delete("dialog");
    const qs = q.toString();
    (open ? router.push : router.replace)(qs ? `${pathname}?${qs}` : pathname);
  };
  const [printing, setPrinting] = React.useState<string[] | null>(null);
  const [scheduling, setScheduling] = React.useState<ScheduleItem[] | null>(null);
  // Phone pages accumulate: handlers read the row at click time, from every row seen so far.
  const seen = React.useRef(new Map<string, TestTagSource>());
  React.useEffect(() => {
    for (const t of items) seen.current.set(t.id, t);
  }, [items]);
  const scheduleItem = (t: TestTagSource): ScheduleItem => ({ id: t.id, testTagId: t.testTagId, assetId: t.linkedAsset?.id ?? null, retired: t.state === "RETIRED" });

  useKeyboardShortcut("n", () => canCreate && router.push("/test-and-tag/new"));

  /** `Sync from assets` (the registry's backfill): registers new items and retires gone ones; says what it did. */
  const sync = async () => {
    try {
      const r = await writes.backfill();
      const parts = [r.created > 0 ? `registered ${r.created}` : null, r.retired > 0 ? `retired ${r.retired}` : null].filter(Boolean);
      toast(parts.length > 0 ? `Sync complete: ${parts.join(", ")}` : "Everything is in sync");
    } catch (e) {
      showError(e, { fallbackTitle: "Could not sync from assets" });
    }
  };

  /** The existing exact Undo of a reactivate puts it back to retired. */
  const reactivate = async (id: string, label: string) => {
    try {
      await writes.reactivate(id);
      announceListWrite({ title: `Reactivated ${label}`, undoneTitle: `${label} is retired again`, performUndo: async () => void (await writes.undoReactivate(id)) });
    } catch (e) {
      showError(e, { fallbackTitle: "Could not reactivate" });
    }
  };

  const rows = items.map((t) =>
    testTagRowOf(
      t,
      buildTestTagActions({
        onOpen: () => router.push(`/test-and-tag/${t.id}`),
        onQuickTest: canCreate ? () => router.push("/scan?mode=tt") : undefined,
        onReactivate: canUpdate && t.state === "RETIRED" ? () => void reactivate(t.id, t.testTagId) : undefined,
        onSchedule: canSchedule && t.state !== "RETIRED" ? () => setScheduling([scheduleItem(t)]) : undefined,
        onExportReport: canReport ? () => void window.open(itemHistoryReportUrl(t.id), "_blank") : undefined,
      }),
    ),
  );
  const primary: ListPrimary | undefined = canCreate ? { label: "Register item", onSelect: () => router.push("/test-and-tag/new") } : undefined;

  return (
    <>
    <ListPage
      spec={TEST_TAG_SPEC}
      title="Test & tag"
      noun="items"
      bulkNoun="item"
      searchPlaceholder="Search tag ID, description, make or serial"
      segments={testTagSegments(counts as Record<string, number | boolean> | undefined)}
      filters={testTagFilters((profiles ?? []).map((p) => ({ id: p.id, name: p.name })))}
      columns={TEST_TAG_COLUMNS}
      columnsKey="test-tag"
      rows={rows}
      total={total}
      loading={isLoading}
      itemHeader={TEST_TAG_ITEM_HEADER}
      itemSortKey={TEST_TAG_ITEM_SORT_KEY}
      primary={primary}
      pageMenu={buildTestTagPageMenu({
        onSync: canCreate ? () => void sync() : undefined,
        onQuickTest: canCreate ? () => router.push("/scan?mode=tt") : undefined,
        onReports: canReport ? () => setReportsOpen(true) : undefined,
      })}
      bulk={(ids) =>
        buildTestTagBulkActions({
          onPrintTags: () => setPrinting(ids),
          onSchedule: canSchedule
            ? () => setScheduling(ids.flatMap((id) => { const t = seen.current.get(id); return t ? [scheduleItem(t)] : []; }))
            : undefined,
        })
      }
      notice={(page as { truncated?: boolean } | undefined)?.truncated ? "Showing the first items only: narrow the list to see the rest." : undefined}
      empty={{ title: "No test and tag items", description: "Register the equipment you test, or sync it from your assets.", action: primary }}
      toolbarExtra={<UrlSavedViewsMenu tableId="test-tag" spec={TEST_TAG_SPEC} state={state} setState={setState} />}
    />
      <ReportsDialog open={reportsOpen} onOpenChange={setReportsOpen} orgId={orgId} />
      <PrintTagsDialog ids={printing} orgId={orgId} onClose={() => setPrinting(null)} />
      <ScheduleTestDialog items={scheduling} onClose={() => setScheduling(null)} />
    </>
  );
}
