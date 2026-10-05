// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Table, TableBody } from "@/components/ui/table";
import { AccessorySelectionContext, KitChildRows } from "./kit-child-rows";
import { accessoryKey, accessoryUnitKey } from "./relocate-accessories";
import type { LineItem } from "./warehouse-types";

type Unit = NonNullable<LineItem["units"]>[number];
const unit = (id: string): Unit => ({
  id, ordinal: 1, assetId: null, bulkAssetId: null, quantity: 1, status: "CONFIRMED", prepStatus: "PACKED",
  asset: null, bulkAsset: { id: "b", assetTag: "TTP00099" },
});
const accessory = {
  id: "batt", type: "EQUIPMENT", status: "CONFIRMED", quantity: 2, checkedOutQuantity: 0, returnedQuantity: 0,
  description: null, modelId: null, assetId: null, bulkAssetId: null, kitId: null, isKitChild: true,
  childKind: "ACCESSORY", parentLineItemId: "hh", model: { name: "AA Battery" }, asset: null, bulkAsset: null, kit: null,
  prepStatus: "PACKED", prepContainer: null, isContainerLineItem: false, isCustomItem: false, subHireId: null, supplier: null,
  units: [unit("u1"), unit("u2")],
} as unknown as LineItem;

function mount(expanded: string[], toggle = vi.fn(), selected = new Set<string>()) {
  render(
    <AccessorySelectionContext.Provider value={{ selected, toggle }}>
      <Table>
        <TableBody>
          <KitChildRows
            kitChildren={[accessory]}
            verifiedKitItems={new Set()}
            expandedGroups={new Set(expanded)}
            toggleExpanded={() => {}}
            onToggleVerify={() => {}}
            mode="deploy"
          />
        </TableBody>
      </Table>
    </AccessorySelectionContext.Provider>,
  );
  return toggle;
}

describe("nested accessory rows are selectable on their own", () => {
  it("the row's checkbox toggles the whole accessory line", () => {
    const toggle = mount([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select AA Battery" }));
    expect(toggle).toHaveBeenCalledWith(accessoryKey("batt"));
  });

  it("an expanded accessory lists a checkbox per unit", () => {
    const toggle = mount(["acc-units-batt"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select unit 2" }));
    expect(toggle).toHaveBeenCalledWith(accessoryUnitKey("u2"));
  });

  it("without a selection provider the row renders no checkbox", () => {
    render(
      <Table><TableBody>
        <KitChildRows kitChildren={[accessory]} verifiedKitItems={new Set()} expandedGroups={new Set()} toggleExpanded={() => {}} onToggleVerify={() => {}} mode="deploy" />
      </TableBody></Table>,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
