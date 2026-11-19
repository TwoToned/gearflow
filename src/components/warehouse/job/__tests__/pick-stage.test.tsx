// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { jobRowIds } from "@/components/warehouse/job/job-table";
import { PickStage } from "@/components/warehouse/job/pick-stage";
import { buildJobSections } from "@/lib/warehouse-job-rows";
import { keysForRowIds, prepSelectionInfo } from "@/lib/warehouse-job-keys";
import type { LineItem } from "@/components/warehouse/warehouse-types";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const li = (over: Partial<LineItem>): LineItem => ({
  id: "l1", type: "EQUIPMENT", status: "CONFIRMED", quantity: 1, checkedOutQuantity: 0, returnedQuantity: 0, description: null,
  modelId: "m", assetId: "a", bulkAssetId: null, kitId: null, isKitChild: false, parentLineItemId: null,
  model: { name: "SM58" }, asset: null, bulkAsset: null, kit: null, prepStatus: null, prepContainer: null,
  isContainerLineItem: false, isCustomItem: false, subHireId: null, supplier: null, ...over,
}) as LineItem;

const items = [
  li({ id: "l1", model: { name: "SM58" } }),
  li({ id: "bulk", assetId: null, bulkAssetId: "b", quantity: 3, model: { name: "XLR 5m" } }),
  li({ id: "v1", model: { name: "Projector" } }),
];
const categoryOf = (l: LineItem) => (l.id === "v1" ? "Video" : "Audio");

/** The page's wiring in miniature: sections -> selection -> keysForRowIds -> the OLD handler. */
function Harness({ onPrep }: { onPrep: (keys: string[]) => void }) {
  const sections = buildJobSections(items, { stage: "pick", containerLabelById: new Map(), categoryOf });
  const selection = useRowSelection(jobRowIds(sections));
  return (
    <PickStage
      sections={sections}
      selection={selection}
      prepInfo={prepSelectionInfo(items, selection.selected)}
      prepHandlers={{
        withAccessories: () => onPrep(keysForRowIds(items, selection.selected, "pick")),
        parentOnly: () => {}, accessoriesWithParent: () => {}, accessoriesIntoActive: () => {}, choose: () => {}, unpackParent: () => {},
      }}
      saleItems={{ items: [], onTogglePicked: () => {}, pendingIds: new Set() }}
      customUnits={{ lines: [], overbookedMap: {}, pendingLineIds: new Set(), onConvert: () => {}, onConvertBack: () => {} }}
      batch={{ mode: "ask", onModeChange: () => {}, names: [], onFinish: () => {}, onClear: () => {} }}
    />
  );
}

describe("To pick stage", () => {
  it("renders category sections in one table", () => {
    render(<Harness onPrep={() => {}} />);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText("Audio")).toBeTruthy();
    expect(screen.getByText("Video")).toBeTruthy();
    expect(screen.getByText("Projector")).toBeTruthy();
  });

  it("Prep hands the legacy handler bare ids and id:i keys for a bulk line", async () => {
    const onPrep = vi.fn();
    render(<Harness onPrep={onPrep} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /XLR 5m/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /SM58/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Prep 4$/ }));
    expect(onPrep).toHaveBeenCalledTimes(1);
    expect([...onPrep.mock.calls[0][0]].sort()).toEqual(["bulk:0", "bulk:1", "bulk:2", "l1"]);
  });
});
