"use client";

import { StageActionBar } from "@/components/warehouse/job/stage-action-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { CustomUnitPanel, type CustomUnitPanelLine } from "@/components/warehouse/custom-unit-panel";
import { SaleItemsToPrep, type SaleItemsToPrepProps } from "@/components/warehouse/sale-items-to-prep";
import { ScanModeBar, type ScanCheckMode } from "@/components/warehouse/scan-prep-dialogs";
import { JobTable } from "@/components/warehouse/job/job-table";
import { PrepSplitButton, type PrepHandlers, type PrepSelectionInfo } from "@/components/warehouse/job/prep-split-button";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { RowSelection } from "@/lib/primitives/types";
import type { JobSection } from "@/lib/warehouse-job-rows";

export interface PickStageProps {
  sections: JobSection[];
  selection: RowSelection;
  prepInfo: PrepSelectionInfo;
  prepHandlers: PrepHandlers;
  saleItems: SaleItemsToPrepProps;
  customUnits: {
    lines: CustomUnitPanelLine[];
    overbookedMap: Record<string, OverbookedInfo>;
    pendingLineIds: ReadonlySet<string>;
    onConvert: (lineItemId: string) => void;
    onConvertBack: (lineItemId: string) => void;
  };
  /** The prep-check mode (as I scan / bulk after) and the scans held for "bulk after scanning". */
  batch: { mode: ScanCheckMode; onModeChange: (m: ScanCheckMode) => void; names: string[]; onFinish: () => void; onClear: () => void };
}

/** The To pick body (spec §9.2): category sections, one `Prep ▾`, and the panels that were on the old tab. */
export function PickStage({ sections, selection, prepInfo, prepHandlers, saleItems, customUnits, batch }: PickStageProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="pick-stage">
      <ScanModeBar mode={batch.mode} onModeChange={batch.onModeChange} batchNames={batch.names} onFinish={batch.onFinish} onClear={batch.onClear} />
      <SaleItemsToPrep {...saleItems} />
      <CustomUnitPanel {...customUnits} />
      {sections.length === 0 ? (
        <EmptyState title="All items prepped" description="Everything is packed. Open Prepped to send it out." />
      ) : (
        <JobTable sections={sections} selection={selection} />
      )}
      <StageActionBar selection={selection}>
        <PrepSplitButton selection={prepInfo} handlers={prepHandlers} />
      </StageActionBar>
    </div>
  );
}
