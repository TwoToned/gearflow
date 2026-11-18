"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFormatters } from "@/components/providers/format-provider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useSubHireWrites } from "@/hooks/use-sub-hire-writes";
import { useSupplier, useSupplierSearch } from "@/hooks/use-suppliers";
import { defaultHireDuration, previewShortfall, type ShortfallPricingType } from "@/lib/sub-hire-shortfall";
import { applyShortfall } from "@/lib/sub-hire-shortfall-apply";
import { getSupplierRateHistory } from "@/server/sub-hires";
import { cn } from "@/lib/utils";
import { Field } from "./line-item-form-fields";
import type { LineItemData } from "./equipment-row-types";

/**
 * Shortfall → sub-hire (spec §7.5, first cut). Opens from an overbooked line's
 * ⋯ › "Sub-hire shortfall", prefilled: model, the short quantity, the job's hire
 * window, supplier chips with their cached last rate, cost, charge (the line's own
 * rate) and a live margin. Writes through the EXISTING sub-hire mutations only
 * (`applyShortfall`): a draft order for the supplier is appended to, else created.
 * Optionally trims the stock line by the covered units, with one Undo for it all.
 */

export interface ShortfallTarget {
  item: LineItemData;
  short: number;
}

export interface DraftOrderRef {
  id: string;
  orderNumber: string;
  supplierId?: string | null;
}

interface RateRow {
  supplierId: string;
  lastUnitCost: number;
  pricingType: ShortfallPricingType;
  supplier?: { name?: string | null } | null;
}

export interface SubHireShortfallSheetProps {
  target: ShortfallTarget | null;
  projectId: string;
  orgId?: string;
  hireStart?: Date | null;
  hireEnd?: Date | null;
  /** The job's DRAFT sub-hire orders, so an existing one for the supplier is appended to. */
  draftOrders: DraftOrderRef[];
  /** Trims the stock line (the tab's own inline quantity write). */
  onSetLineQuantity: (item: LineItemData, qty: number) => Promise<unknown>;
  onClose: () => void;
}

const toNum = (v: string): number | null => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const PRICING_LABEL: Record<ShortfallPricingType, string> = { FLAT: "flat", PER_DAY: "/day", PER_WEEK: "/wk", PER_HOUR: "/hr" };

function SupplierChips({
  rates,
  value,
  onPick,
  formatCurrency,
}: {
  rates: RateRow[];
  value: string;
  onPick: (r: RateRow) => void;
  formatCurrency: (n: number | null) => string;
}) {
  if (rates.length === 0) return <p className="text-caption text-muted">No rate history for this model yet.</p>;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Suppliers with a cached rate">
      {rates.map((r) => (
        <button
          key={r.supplierId}
          type="button"
          aria-pressed={r.supplierId === value}
          onClick={() => onPick(r)}
          className={cn(
            "touch-target rounded-[var(--r)] border px-3 py-1.5 text-left text-table-cell",
            r.supplierId === value ? "border-rep bg-elev text-ink" : "border-line text-ink-2 hover:bg-elev/50",
          )}
        >
          <span className="font-medium">{r.supplier?.name ?? "Supplier"}</span>
          <span className="ml-2 tabular-nums text-muted">
            {formatCurrency(r.lastUnitCost)} {PRICING_LABEL[r.pricingType]}
          </span>
        </button>
      ))}
    </div>
  );
}

function ShortfallBody({ target, ...p }: Omit<SubHireShortfallSheetProps, "target"> & { target: ShortfallTarget }) {
  const { item, short } = target;
  const { formatCurrency } = useFormatters();
  const writes = useSubHireWrites();
  const modelName = item.model?.name ?? item.description ?? "Item";

  const { data: allRates } = useServerQuery({
    queryKey: ["model-rates", item.modelId],
    queryFn: () => getSupplierRateHistory(item.modelId!),
    enabled: !!item.modelId,
  });
  const rates = ((allRates ?? []) as unknown as RateRow[]).filter((r) => r.supplierId);

  const [supplierId, setSupplierId] = useState("");
  const [pricingType, setPricingType] = useState<ShortfallPricingType>("FLAT");
  const [qty, setQty] = useState(String(short));
  const [unitCost, setUnitCost] = useState("");
  const [duration, setDuration] = useState(String(item.duration ?? 1));
  const [unitCharge, setUnitCharge] = useState(item.unitPrice == null ? "" : String(Number(item.unitPrice)));
  const [trim, setTrim] = useState(item.quantity > short);
  const [supplierQuery, setSupplierQuery] = useState("");
  const results = useSupplierSearch(p.orgId, useDebouncedValue(supplierQuery, 200));
  const picked = useSupplier(supplierId || undefined);

  const pickRate = (r: RateRow) => {
    setSupplierId(r.supplierId);
    setUnitCost(String(r.lastUnitCost));
    setPricingType(r.pricingType);
    setDuration(String(defaultHireDuration(r.pricingType, p.hireStart, p.hireEnd)));
  };

  const quantity = toNum(qty) ?? 0;
  const preview = previewShortfall({ quantity, unitCost: toNum(unitCost), unitCharge: toNum(unitCharge), duration: toNum(duration) ?? 1 });
  const draft = p.draftOrders.find((o) => o.supplierId === supplierId);
  const canTrim = item.quantity > quantity;

  const mutation = useServerMutation({
    mutationFn: () =>
      applyShortfall({
        writes,
        head: { supplierId, projectId: p.projectId, hireStart: p.hireStart ?? undefined, hireEnd: p.hireEnd ?? undefined },
        draftOrderId: draft?.id,
        item: {
          modelId: item.modelId ?? undefined,
          description: modelName,
          quantity,
          unitCost: toNum(unitCost) ?? 0,
          unitCharge: toNum(unitCharge) ?? 0,
          pricingType,
          duration: toNum(duration) ?? 1,
          discount: 0,
        },
        reduce: trim && canTrim ? { from: item.quantity, to: item.quantity - quantity, setQuantity: (n) => p.onSetLineQuantity(item, n) } : undefined,
      }),
    onSuccess: (done) => {
      toast.success(`Sub-hire added for ${modelName}`, {
        action: { label: "Undo", onClick: () => void done.undo().catch((e: Error) => toast.error(e.message)) },
      });
      p.onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = !!supplierId && quantity > 0 && toNum(unitCost) != null && !mutation.isPending;
  return (
    <>
      <SheetHeader>
        <SheetTitle>Sub-hire {short} × {modelName}</SheetTitle>
        <SheetDescription>
          {short} short on this job{p.hireStart && p.hireEnd ? ` · ${p.hireStart.toLocaleDateString()} – ${p.hireEnd.toLocaleDateString()}` : ""}.
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <Field label="Supplier">
          <SupplierChips rates={rates} value={supplierId} onPick={pickRate} formatCurrency={formatCurrency} />
          <ComboboxPicker
            value={supplierId}
            onChange={(id) => { setSupplierId(id); setUnitCost(""); }}
            options={(results ?? []).filter((s) => s.isActive ?? true).map((s) => ({ value: s.id, label: s.name }))}
            onSearchChange={setSupplierQuery}
            loading={results === undefined}
            selectedLabel={picked?.name}
            placeholder="Another supplier…"
            searchPlaceholder="Search suppliers…"
            emptyMessage="No suppliers found."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label={`Duration (${PRICING_LABEL[pricingType]})`}><Input type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
          <Field label="Unit cost"><Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
          <Field label="Unit charge"><Input type="number" min={0} step="0.01" value={unitCharge} onChange={(e) => setUnitCharge(e.target.value)} /></Field>
        </div>
        <dl aria-label="Live margin" className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-muted tabular-nums">
          <div className="flex gap-2"><dt>Cost</dt><dd className="text-ink-2">{formatCurrency(preview.cost)}</dd></div>
          <div className="flex gap-2"><dt>Charge</dt><dd className="text-ink-2">{formatCurrency(preview.charge)}</dd></div>
          <div className="flex gap-2">
            <dt>Margin</dt>
            <dd className="text-ink-2">{formatCurrency(preview.margin)}{preview.marginPct == null ? "" : ` (${Math.round(preview.marginPct)}%)`}</dd>
          </div>
        </dl>
        {canTrim && (
          <label className="flex items-center gap-2 text-table-cell text-ink-2">
            <Checkbox checked={trim} onCheckedChange={(c) => setTrim(c === true)} />
            Reduce this line to the {item.quantity - quantity} we hold in stock (the sub-hire carries the rest)
          </label>
        )}
        <p className="text-caption text-muted">
          {supplierId ? (draft ? `Adds to draft order ${draft.orderNumber}.` : "Creates a new draft order.") : "Pick a supplier."}
        </p>
      </div>
      <SheetFooter>
        <Button type="button" variant="line" onClick={p.onClose}>Cancel</Button>
        <Button type="button" loading={mutation.isPending} disabled={!ready} onClick={() => mutation.mutate()}>Add sub-hire</Button>
      </SheetFooter>
    </>
  );
}

export function SubHireShortfallSheet(props: SubHireShortfallSheetProps) {
  const { target, onClose } = props;
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        {target && <ShortfallBody key={target.item.id} {...props} target={target} />}
      </SheetContent>
    </Sheet>
  );
}
