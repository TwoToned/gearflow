"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EquipmentAddBar } from "@/components/projects/equipment-add-bar";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormatters } from "@/components/providers/format-provider";
import { useNativeEquipmentTab } from "@/hooks/use-native-equipment-tab";
import { useLineItemWrites } from "@/hooks/use-line-item-writes";
import type { LineItemData } from "@/components/projects/equipment-rows";
import type { OverbookedInfo } from "@/lib/overbooking-core";
import type { ActionMenuSpec } from "@/lib/primitives/types";

/**
 * Wizard step 2, What: the Equipment tab's search-first add (the SAME
 * `EquipmentAddBar` and write path, pointed at the draft) plus the draft's lines
 * as rows: qty inline, price, total, `short n` / `unpriced` flags, ⋯, always-on
 * checkboxes and a bulk `Remove n`. Sub-hire, custom and sale items open from the
 * job's Equipment tab (the wizard never had them).
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

export function StepWhat({ draftId, orgId, data }: { draftId: string | undefined; orgId: string | undefined; data: WizardLines }) {
  const writes = useLineItemWrites();
  const { formatCurrency } = useFormatters();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const { lines, overbooked } = data;

  if (!draftId) {
    return <p className="text-ui-text text-muted">Name the job on the first step and its draft starts, then add gear here.</p>;
  }
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const remove = async (ids: string[]) => {
    try {
      const r = await writes.removeMany(ids);
      setPicked(new Set());
      toast.success(`Removed ${r.removed} line${r.removed === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} skipped` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const setQty = async (line: LineItemData, qty: number) => {
    if (!Number.isFinite(qty) || qty < 1 || qty === line.quantity) return;
    try {
      await writes.update(line.id, { quantity: qty }, [], { entityName: line.description ?? "Line", allowOverbook: false });
    } catch (e) {
      toast.error((e as Error).message);
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
      {lines.length === 0 ? (
        <p className="text-ui-text text-muted">No gear yet. Search a model or kit above and press Enter to add it.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line" aria-label="Gear on this job">
          {lines.map((l) => (
            <LineItemRow
              key={l.id} line={l} short={overbooked[l.id]?.overBy ?? 0} checked={picked.has(l.id)}
              money={(n) => formatCurrency(n, { cents: false })}
              onToggle={() => toggle(l.id)} onQty={(q) => void setQty(l, q)} onRemove={remove}
            />
          ))}
        </ul>
      )}
      {picked.size > 0 && (
        <div className="flex items-center gap-3 text-table-cell" role="toolbar" aria-label="Selected lines">
          <span className="text-muted">{picked.size} selected</span>
          <Button type="button" variant="line" size="sm" onClick={() => void remove([...picked])}>Remove {picked.size}</Button>
          <button type="button" className="text-muted underline-offset-4 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
    </div>
  );
}

function LineItemRow({
  line: l, short, checked, money, onToggle, onQty, onRemove,
}: {
  line: LineItemData; short: number; checked: boolean; money: (n: number) => string;
  onToggle: () => void; onQty: (qty: number) => void; onRemove: (ids: string[]) => void | Promise<void>;
}) {
  const name = l.description ?? "line";
  const priced = l.unitPrice != null && l.unitPrice !== "";
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <input type="checkbox" aria-label={`Select ${name}`} checked={checked} onChange={onToggle} className="size-[22px] shrink-0 md:size-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui-text font-medium text-ink">{l.description}</p>
        <p className="text-caption">
          {short > 0 && <span className="mr-2 text-t-out">short {short}</span>}
          {!priced && <span className="text-warn">unpriced</span>}
        </p>
      </div>
      <Input
        key={`${l.id}:${l.quantity}`}
        type="number" min={1} inputMode="numeric" aria-label={`Quantity of ${name}`}
        defaultValue={l.quantity} onBlur={(e) => onQty(Number(e.target.value))}
        className="h-11 w-16 text-center md:h-9"
      />
      <span className="w-20 text-right font-mono text-table-cell text-ink">{priced ? money(Number(l.lineTotal) || 0) : "—"}</span>
      <ActionMenu spec={rowMenu(l, onRemove)} label={`Actions for ${name}`} />
    </li>
  );
}

function rowMenu(line: LineItemData, remove: (ids: string[]) => void | Promise<void>): ActionMenuSpec {
  return {
    items: [{
      key: "remove", label: "Remove", group: "danger", danger: true,
      confirm: { title: "Remove this line?", body: `${line.description ?? "This line"} comes off the job. Nothing else changes.`, confirmLabel: "Remove" },
      onSelect: () => remove([line.id]),
    }],
  };
}
