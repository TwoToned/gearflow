"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Overline, RecordRows, type RecordRow } from "@/components/people/record-shell";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { formatCurrency } from "@/lib/formatters";
import { fromDateInput, toDateInput } from "@/lib/date-input";
import { buildMaintenancePartActions } from "@/lib/row-actions/maintenance";
import { useMaintenanceRecordWrites, type PartInput } from "@/components/maintenance/record/use-maintenance-record-writes";
import { api } from "../../../../convex/_generated/api";

/** A part as the read returns it (`unitPrice` is ABSENT for a caller who cannot see job cost). */
export interface PartRow {
  id: string;
  name: string;
  supplierName: string | null;
  quantity: number;
  etaDate: number | null;
  arrivedAt: number | null;
  unitPrice?: number | null;
}

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** The text of the part form's boxes, kept as typed so a blank price is BLANK (never 0). */
interface PartDraft {
  name: string;
  supplierName: string;
  quantity: string;
  unitPrice: string;
  etaDate: string;
}
const EMPTY: PartDraft = { name: "", supplierName: "", quantity: "1", unitPrice: "", etaDate: "" };
const draftOf = (p: PartRow): PartDraft => ({ name: p.name, supplierName: p.supplierName ?? "", quantity: String(p.quantity), unitPrice: p.unitPrice == null ? "" : String(p.unitPrice), etaDate: toDateInput(p.etaDate) });

/** A date box's value as epoch ms (UTC midnight), or `undefined` when blank or not a date. */
function dayMs(s: string): number | undefined {
  const ms = s ? fromDateInput(s) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

/** The one message that says what to fix in the draft, or `null` when it is good to send. */
function draftError(d: PartDraft): string | null {
  const quantity = Number(d.quantity);
  if (!d.name.trim()) return "A part needs a name.";
  if (!Number.isInteger(quantity) || quantity < 1) return "Quantity must be a whole number, at least 1.";
  const price = d.unitPrice.trim() === "" ? undefined : Number(d.unitPrice);
  return price !== undefined && (!Number.isFinite(price) || price < 0) ? "Price can't be negative." : null;
}

/** A VALID draft as the write takes it: blank optional boxes are absent, the price only when the caller can set one. */
function inputOf(d: PartDraft, canPrice: boolean): PartInput {
  const price = d.unitPrice.trim() === "" ? undefined : Number(d.unitPrice);
  const eta = dayMs(d.etaDate);
  return {
    name: d.name.trim(),
    quantity: Number(d.quantity),
    ...(d.supplierName.trim() ? { supplierName: d.supplierName.trim() } : {}),
    ...(canPrice && price !== undefined ? { unitPrice: price } : {}),
    ...(eta !== undefined ? { etaDate: eta } : {}),
  };
}

function PartDialog({ open, onOpenChange, part, canPrice, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; part: PartRow | null; canPrice: boolean; onSave: (input: PartInput, d: PartDraft) => Promise<void> }) {
  const [draft, setDraft] = React.useState<PartDraft>(EMPTY);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDraft(part ? draftOf(part) : EMPTY);
      setError(null);
    }
  }, [open, part]);
  const set = (k: keyof PartDraft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = draftError(draft);
    if (bad) return setError(bad);
    setSaving(true);
    try {
      await onSave(inputOf(draft, canPrice), draft);
      onOpenChange(false);
    } catch (err) {
      showError(err, { fallbackTitle: part ? "Could not save the part" : "Could not add the part" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{part ? "Edit part" : "Add part"}</DialogTitle>
            <DialogDescription>What was ordered or used on this job. A blank price stays blank: it is not $0.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="part-name">Name</Label>
              <Input id="part-name" value={draft.name} onChange={set("name")} placeholder="Gas strut" autoFocus />
            </div>
            <div>
              <Label htmlFor="part-supplier">Supplier</Label>
              <Input id="part-supplier" value={draft.supplierName} onChange={set("supplierName")} placeholder="Optional" />
            </div>
            <div>
              <Label htmlFor="part-qty">Quantity</Label>
              <Input id="part-qty" type="number" min={1} step={1} value={draft.quantity} onChange={set("quantity")} />
            </div>
            {canPrice ? (
              <div>
                <Label htmlFor="part-price">Unit price ($)</Label>
                <Input id="part-price" type="number" min={0} step="0.01" value={draft.unitPrice} onChange={set("unitPrice")} placeholder="0.00" />
              </div>
            ) : null}
            <div>
              <Label htmlFor="part-eta">ETA</Label>
              <Input id="part-eta" type="date" value={draft.etaDate} onChange={set("etaDate")} />
            </div>
          </div>
          {error ? <p role="alert" className="text-caption text-t-out">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{part ? "Save" : "Add part"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Writes = ReturnType<typeof useMaintenanceRecordWrites>;
type CostFacts = NonNullable<ReturnType<typeof useAuthedQuery<typeof api.maintenanceParts.listForRecord>>>["cost"];

/** The summary sentence under the Parts overline. */
function summaryText(s: { count: number; onOrder: number; arrived: number; nextEta: number | null; late: number }): string {
  if (s.count === 0) return "No parts on this job";
  const next = s.nextEta != null ? ` · next ${dayLabel(s.nextEta)}` : "";
  const late = s.late > 0 ? ` · ${s.late} past ETA` : "";
  return `${s.count} part${s.count === 1 ? "" : "s"} · ${s.onOrder} on order · ${s.arrived} arrived${next}${late}`;
}

/** One part as a row: on order or arrived, with its quantity × price (the price only when the read carried one). */
function partRow(p: PartRow, canPrice: boolean, trailing: React.ReactNode): RecordRow {
  const arrived = p.arrivedAt != null;
  const price = canPrice && p.unitPrice != null ? `${p.quantity} × ${formatCurrency(p.unitPrice)}` : `${p.quantity}×`;
  const eta = !arrived && p.etaDate != null ? `ETA ${dayLabel(p.etaDate)}` : null;
  return {
    id: p.id,
    title: p.name,
    meta: [p.supplierName, price, arrived ? `Arrived ${dayLabel(p.arrivedAt!)}` : eta],
    status: arrived ? { label: "Arrived", intent: "success" } : { label: "On order", intent: "warning" },
    trailing,
  };
}

/** The derived cost (parts + labour), only ever rendered for a caller who sees job cost. */
function CostSection({ cost }: { cost: NonNullable<CostFacts> }) {
  const row = (label: string, value: number | null, strong = false) => (
    <div className={strong ? "flex gap-3 font-medium" : "flex gap-3"}>
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className="tabular-nums text-ink">{value == null ? "—" : formatCurrency(value)}</dd>
    </div>
  );
  return (
    <section aria-label="Cost">
      <Overline>Cost</Overline>
      <dl className="space-y-1 text-table-cell">
        {row("Parts", cost.parts)}
        {row("Labour", cost.labour)}
        {row("Total", cost.total, true)}
      </dl>
      {cost.unpricedParts > 0 ? <p className="mt-1 text-caption text-muted">{cost.unpricedParts} part{cost.unpricedParts === 1 ? " has" : "s have"} no price, so the parts figure is a floor.</p> : null}
    </section>
  );
}

/** Which optional boxes the person emptied: those fields are CLEARED (the price only for a caller who can set one). */
function clearedFields(draft: PartDraft, canPrice: boolean): string[] {
  return [
    ...(draft.supplierName.trim() === "" ? ["supplierName"] : []),
    ...(draft.etaDate === "" ? ["etaDate"] : []),
    ...(canPrice && draft.unitPrice.trim() === "" ? ["unitPrice"] : []),
  ];
}

/** The part commands, each announced with the Undo of ITS OWN write (never derived a second way). */
function partCommands(writes: Writes) {
  const undoOf = (auditId: string) => async () => void (await writes.undoPart(auditId));
  return {
    markArrived: async (p: PartRow) => {
      try {
        const r = await writes.markArrived(p.id);
        if (!r.changed) return void toast("Already arrived");
        announceListWrite({ title: r.advanced ? `${p.name} arrived: the job is back In progress` : `${p.name} arrived`, undoneTitle: "Arrival undone", performUndo: undoOf(r.auditId) });
      } catch (e) {
        showError(e, { fallbackTitle: "Could not mark the part arrived" });
      }
    },
    remove: async (p: PartRow) => {
      try {
        const r = await writes.removePart(p.id);
        announceListWrite({ title: `Removed ${p.name}`, undoneTitle: `${p.name} is back`, performUndo: undoOf(r.auditId) });
      } catch (e) {
        showError(e, { fallbackTitle: "Could not remove the part" });
      }
    },
    save: async (editing: PartRow | "new" | null, canPrice: boolean, input: PartInput, draft: PartDraft) => {
      if (editing === "new" || editing === null) {
        const r = await writes.addPart(input);
        announceListWrite({ title: `Added ${input.name}`, undoneTitle: `${input.name} removed`, performUndo: undoOf(r.auditId) });
        return;
      }
      const r = await writes.editPart(editing.id, input, clearedFields(draft, canPrice));
      if (!r.changed) toast("Nothing changed");
      else announceListWrite({ title: `Updated ${input.name}`, undoneTitle: "Change undone", performUndo: undoOf(r.auditId) });
    },
  };
}

/**
 * The record's Parts tab (UX Phase 14, 14b-3, D76): parts as rows (name, supplier, quantity × price, ETA, on order or
 * arrived) with the DERIVED parts summary and cost (parts + labour). Every write has an exact Undo from the toast.
 * Price and cost are ABSENT for a caller who cannot see job cost. The old free-text `partsUsed` stays readable.
 */
export function PartsTab({ orgId, recordId, now, canUpdate, partsUsedNote }: { orgId: string | undefined; recordId: string; /** The page's stable now: the page and this tab share ONE subscription (the args are its key). */ now: number; canUpdate: boolean; partsUsedNote?: string | null }) {
  const data = useAuthedQuery(api.maintenanceParts.listForRecord, orgId ? { orgId, recordId, now } : "skip");
  const writes = useMaintenanceRecordWrites(orgId, recordId);
  const [editing, setEditing] = React.useState<PartRow | "new" | null>(null);

  if (!data) return <p className="py-6 text-table-cell text-muted">Loading parts…</p>;
  const parts = data.parts as PartRow[];
  const canPrice = data.cost !== null; // present only for a caller who sees job cost
  const { summary, cost } = data;

  const commands = partCommands(writes);
  const rows: RecordRow[] = parts.map((p) =>
    partRow(
      p,
      canPrice,
      canUpdate ? (
        <ActionMenu
          label={`${p.name} actions`}
          spec={buildMaintenancePartActions({ name: p.name, arrived: p.arrivedAt != null, onEdit: () => setEditing(p), onMarkArrived: () => void commands.markArrived(p), onRemove: () => void commands.remove(p) })}
        />
      ) : undefined,
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Overline>Parts</Overline>
          <p className="text-table-cell text-ink">{summaryText(summary)}</p>
        </div>
        {canUpdate ? (
          <Button variant="line" size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1.5 size-4" /> Add part
          </Button>
        ) : null}
      </div>

      <RecordRows rows={rows} noun="part" empty="No parts yet. Add what was ordered or used." />

      {cost ? <CostSection cost={cost} /> : null}

      {partsUsedNote ? (
        <section aria-label="Earlier note">
          <Overline>Earlier note</Overline>
          <p className="max-w-prose whitespace-pre-wrap text-table-cell text-ink-2">{partsUsedNote}</p>
        </section>
      ) : null}

      <PartDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} part={editing === "new" ? null : editing} canPrice={canPrice} onSave={(input, draft) => commands.save(editing, canPrice, input, draft)} />
    </div>
  );
}
