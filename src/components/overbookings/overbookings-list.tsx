"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { SubHireShortfallDialog } from "@/components/overbookings/sub-hire-shortfall-dialog";
import { ListPage } from "@/components/ui/list-page";
import { UrlSavedViewsMenu } from "@/components/ui/url-saved-views";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { useNativeOverbookingBoard } from "@/hooks/use-native-overbooking-board";
import { useActiveOrganization } from "@/lib/auth-client";
import {
  OVERBOOKINGS_SPEC,
  OVERBOOKING_COLUMNS,
  OVERBOOKING_ITEM_HEADER,
  OVERBOOKING_ITEM_SORT_KEY,
  daysForSegment,
  flattenBoard,
  overbookingFilters,
  overbookingRowOf,
  overbookingSegments,
  pageRows,
  rowsForState,
  segFromDays,
  type OverbookingRowSource,
} from "@/lib/list-views/overbookings";
import { buildOverbookingActions } from "@/lib/row-actions/overbooking";

/** Keyed by org: an org switch never leaves the previous org's open dialog behind. */
export function OverbookingsList() {
  const { data: activeOrg } = useActiveOrganization();
  return <OverbookingsListInner key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

/** The old `?days=` link (and nothing else) becomes the strip word, once, and is dropped from the URL. */
function useDaysAlias(hasSeg: boolean, setSeg: (seg: string) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const alias = segFromDays(params.get("days"));
  React.useEffect(() => {
    if (params.get("days") == null) return;
    const next = new URLSearchParams(params.toString());
    next.delete("days");
    if (!hasSeg && alias) next.set("seg", alias);
    router.replace(next.size ? `/overbookings?${next.toString()}` : "/overbookings");
    if (!hasSeg && alias) setSeg(alias);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per arrival of the alias param
  }, [params.get("days")]);
}

function OverbookingsListInner({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const params = useSearchParams();
  const { state, setState } = useListUrlState(OVERBOOKINGS_SPEC);
  useDaysAlias(params.get("seg") != null, (seg) => setState({ ...state, seg, page: 1 }, "replace"));
  const { data, isLoading } = useNativeOverbookingBoard(orgId, daysForSegment(state.seg));
  const [subHire, setSubHire] = React.useState<OverbookingRowSource["subHire"] | null>(null);

  const all = React.useMemo(() => (data ? flattenBoard(data) : []), [data]);
  const shown = React.useMemo(() => rowsForState(all, state), [all, state]);
  const rows = pageRows(shown, state.page).map((r) =>
    overbookingRowOf(
      r,
      buildOverbookingActions({
        jobs: r.jobs,
        onOpenJob: (id) => router.push(`/projects/${id}`),
        onOpenModel: r.modelId ? () => router.push(`/assets/models/${r.modelId}`) : undefined,
        onSubHire: r.subHire ? () => setSubHire(r.subHire) : undefined,
        onReorder: r.group === "sale" ? () => router.push(`/assets/sales-stock?q=${encodeURIComponent(r.title)}`) : undefined,
      }),
    ),
  );

  return (
    <>
      <ListPage
        spec={OVERBOOKINGS_SPEC}
        title="Overbookings"
        noun="issues"
        bulkNoun="issue"
        searchPlaceholder="Search gear, job or crew"
        segments={overbookingSegments(state.seg, data ? all.length : undefined)}
        filters={overbookingFilters()}
        columns={OVERBOOKING_COLUMNS}
        rows={rows}
        total={shown.length}
        loading={isLoading}
        itemHeader={OVERBOOKING_ITEM_HEADER}
        itemSortKey={OVERBOOKING_ITEM_SORT_KEY}
        empty={{ title: "All clear", description: "No overbookings, no crew gaps, nothing pencilled that would collide in this window." }}
        toolbarExtra={<UrlSavedViewsMenu tableId="overbookings" spec={OVERBOOKINGS_SPEC} state={state} setState={setState} />}
      />
      {subHire && (
        <SubHireShortfallDialog
          open
          onOpenChange={(open) => !open && setSubHire(null)}
          modelName={subHire.modelName}
          shortfallQty={subHire.qty}
          projects={subHire.projects}
        />
      )}
    </>
  );
}
