"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EquipmentAddBar } from "@/components/projects/equipment-add-bar";
import { EQUIPMENT_COLUMNS, equipmentRowModel } from "@/lib/equipment-row-model";
import { InlineEditablePrice, InlineEditableQuantity } from "@/components/projects/line-item-inline-cells";
import { BulkBar } from "@/components/ui/bulk-bar";
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import { LineRowList, visibleRowIds } from "@/components/ui/line-row";
import { useNativeEquipmentTab } from "@/hooks/use-native-equipment-tab";
import { updateLineItemFromPayload, useLineItemWrites } from "@/hooks/use-line-item-writes";
import { useRowSelection } from "@/lib/primitives/use-row-selection";
import { computeInlineLineItemPayload, type InlineLineItemPatch } from "@/lib/line-item-edit-payload";
import { buildGearLineActions } from "@/lib/row-actions/gear-line";
import { buildBulkEquipmentActions } from "@/lib/row-actions/bulk-equipment";
import type { LineItemData } from "@/components/projects/equipment-rows";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { LineRowData } from "@/lib/primitives/types";

/**
 * Wizard step 2, What: the Equipment tab's search-first add (the SAME
 * `EquipmentAddBar`) pointed at the draft, and the draft's lines as the Equipment
 * tab's own rows: `equipmentRowModel` for the title, flags and facts (so `short n`
 * and `unpriced` read the same), `buildGearLineActions` for the row ⋯ (a handler a
 * draft does not have is absent, never dead), the same inline qty/price cells and
 * the same write (`updateLineItemFromPayload`), `BulkBar` + `buildBulkEquipmentActions`
 * for the ticks. Sub-hire, custom and sale items open from the job's Equipment tab.
 */
export interface WizardLines {
  lines: LineItemData[];
  overbooked: Record<string, OverbookedInfo>;
  total: number;
  isLoading: boolean;
}

/** The draft's top-level gear lines, shared by the What and Review steps. */
export function useWizardLines(draftId: string | undefined, orgId: string | undefined): WizardLines {
  const tab = useNativeEquipmentTab(draftId, orgId);
  const lines = [...tab.uncategorizedItems, ...tab.categories.flatMap((c) => c.lineItems ?? [])].filter((l) => !l.isKitChild);
  const total = lines.reduce((sum, l) => sum + (Number(l.lineTotal) || 0), 0);
  return { lines, overbooked: tab.overbookedMap, total, isLoading: tab.isLoading };
}

// A draft has no stage, availability-by-asset or discount columns: the Equipment tab's own qty, unit and total.
const COLUMNS = EQUIPMENT_COLUMNS.filter((c) => c.id === "qty" || c.id === "unit" || c.id === "total");
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

export function StepWhat({ draftId, orgId, data }: { draftId: string | undefined; orgId: string | undefined; data: WizardLines }) {
  const writes = useLineItemWrites();
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const { lines, overbooked } = data;

  const edit = (item: LineItemData, patch: Exclude<InlineLineItemPatch, { field: "discountPercent" }>) =>
    updateLineItemFromPayload(writes, item.id, computeInlineLineItemPayload(item, patch) as unknown as Record<string, unknown>, patch.field === "quantity" ? patch.allowOverbook : false)
      .catch((e: Error) => { if (!/INSUFFICIENT_STOCK/.test(e.message)) toast.error(e.message); throw e; });

  const rows: LineRowData[] = lines.map((item) => {
    const model = equipmentRowModel(item, { overbooked: overbooked[item.id] });
    return {
      id: item.id, kind: model.kind, title: model.title, subtitle: model.subtitle, tags: model.tags,
      glyphs: model.glyphs, flags: model.flags, facts: model.facts,
      cells: {
        qty: <InlineEditableQuantity value={item.quantity} onSave={(next, allowOverbook) => edit(item, { field: "quantity", value: next, allowOverbook })} />,
        unit: <InlineEditablePrice value={num(item.unitPrice)} onSave={(next) => edit(item, { field: "unitPrice", value: next })} />,
      },
      menu: buildGearLineActions({ ...item, title: model.title }, { onRemove: () => setConfirmIds([item.id]) }),
    };
  });
  const selection = useRowSelection(visibleRowIds([{ section: { id: "lines", title: "Lines" }, rows, headless: true }]));

  if (!draftId) {
    return <p className="text-ui-text text-muted">Name the job on the first step and its draft starts, then add gear here.</p>;
  }
  const remove = async (ids: string[]) => {
    setRemoving(true);
    try {
      const r = await writes.removeMany(ids);
      selection.clear();
      toast.success(`Removed ${r.removed} line${r.removed === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} skipped` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemoving(false);
      setConfirmIds(null);
    }
  };

  return (
    <div className="space-y-4">
      <EquipmentAddBar
        projectId={draftId}
        orgId={orgId}
        invalidate={() => {}}
        onOpenDialog={() => toast.info("Add sub-hire, custom and sale items from the job's Equipment tab once it is created.")}
      />
      {rows.length === 0 ? (
        <p className="text-ui-text text-muted">No gear yet. Search a model or kit above and press Enter to add it.</p>
      ) : (
        <LineRowList rows={rows} columns={COLUMNS} selection={selection} />
      )}
      <BulkBar
        noun="line"
        selection={selection}
        actions={buildBulkEquipmentActions([], { onDelete: () => setConfirmIds([...selection.selected]) })}
      />
      <BulkDeleteDialog
        open={confirmIds != null}
        onOpenChange={(o) => !o && setConfirmIds(null)}
        title="Remove from this job"
        description="The selected lines come off the draft job. Kit and accessory members go with their parent."
        count={confirmIds?.length ?? 0}
        itemLabel="line"
        confirmLabel={`Remove ${confirmIds?.length ?? 0} line${confirmIds?.length === 1 ? "" : "s"}`}
        pending={removing}
        onConfirm={() => void remove(confirmIds ?? [])}
      />
    </div>
  );
}
