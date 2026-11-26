"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showError } from "@/lib/show-error";
import { assetDispositionLabels } from "@/lib/status-labels";
import { fromDateInput, toDateInput } from "@/lib/date-input";
import { MAX_MAINTENANCE_MONEY } from "../../../../convex/lib/maintenanceCost";
import type { CompleteInput } from "@/components/maintenance/record/use-maintenance-record-writes";

type Result = CompleteInput["result"];
type Disposition = NonNullable<CompleteInput["dispositions"]>[number]["disposition"];

const RESULTS: { value: Result; label: string }[] = [
  { value: "PASS", label: "Pass" },
  { value: "CONDITIONAL", label: "Conditional" },
  { value: "FAIL", label: "Fail" },
];
/** The words come from the ONE table (`assetDispositionLabels`), in the order the dialog offers them. */
const DISPOSITIONS: { value: Disposition; label: string }[] = (["RETURN_TO_SERVICE", "KEEP_OUT_OF_SERVICE", "RETIRE"] as const).map((value) => ({ value, label: assetDispositionLabels[value] }));

/** What each asset does when the caller chose nothing: a Fail keeps it out, anything else returns it. The SERVER owns this default; this only shows it. */
export const defaultDisposition = (result: Result): Disposition => (result === "FAIL" ? "KEEP_OUT_OF_SERVICE" : "RETURN_TO_SERVICE");

/** A box that clears a stored value when emptied and leaves an absent one alone: `undefined` = leave, `null` = clear, a number = set. */
function changeOf(text: string, stored: number | null, parse: (s: string) => number): { value: number | null | undefined; bad: boolean } {
  if (text.trim() === "") return { value: stored == null ? undefined : null, bad: false };
  const n = parse(text);
  return { value: n, bad: !Number.isFinite(n) };
}

interface CompleteDraft {
  result: Result;
  date: string;
  labour: string;
  nextDue: string;
  overrides: Record<string, Disposition>;
  labourVisible: boolean;
  storedLabour: number | null;
  storedNextDue: number | null;
}

/** A labour box that parsed and sits inside the write's own bounds (blank / unchanged is fine). */
function labourInRange(l: { bad: boolean; value?: unknown }): boolean {
  if (l.bad) return false;
  return typeof l.value !== "number" || (l.value >= 0 && l.value <= MAX_MAINTENANCE_MONEY);
}

/** The dialog's boxes as the write takes them, or the one message that says what to fix. Only what the person changed is sent. */
function buildCompleteInput(d: CompleteDraft): { input: CompleteInput } | { error: string } {
  const completedDate = d.date ? fromDateInput(d.date) : NaN;
  if (!Number.isFinite(completedDate)) return { error: "Choose the date it was completed." };
  const labour = changeOf(d.labour, d.storedLabour, Number);
  if (d.labourVisible && !labourInRange(labour)) return { error: `Labour must be between 0 and ${MAX_MAINTENANCE_MONEY.toLocaleString("en-AU")}.` };
  const next = changeOf(d.nextDue, d.storedNextDue, fromDateInput);
  if (next.bad) return { error: "Choose a valid next due date." };
  const dispositions = Object.entries(d.overrides).map(([assetId, disposition]) => ({ assetId, disposition }));
  return {
    input: {
      result: d.result,
      completedDate,
      ...(d.labourVisible ? { labour: labour.value } : {}),
      nextDueDate: next.value,
      ...(dispositions.length > 0 ? { dispositions } : {}),
    },
  };
}

export interface CompleteAsset {
  assetId: string;
  assetTag: string;
  modelName: string;
}

/**
 * The Complete dialog (UX Phase 14, 14b-3, §9n.3): result, completed date, labour (blank is not $0), next due, and a
 * per-asset disposition that DEFAULTS from the result and only sends what the person changed. Cost is not a field: it
 * is derived (parts + labour). `labour` is offered only when the record carried one (`labourVisible`), i.e. to a
 * caller who sees job cost. Retire is terminal, so the dialog says that Complete then has no Undo.
 */
export function CompleteDialog({
  open,
  onOpenChange,
  title,
  now,
  assets,
  labourVisible,
  storedLabour,
  storedNextDue,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A stable "today" (the dialog never reads the clock itself). */
  now: number;
  assets: CompleteAsset[];
  labourVisible: boolean;
  storedLabour: number | null;
  storedNextDue: number | null;
  onComplete: (input: CompleteInput) => Promise<void>;
}) {
  const [result, setResult] = React.useState<Result>("PASS");
  const [date, setDate] = React.useState("");
  const [labour, setLabour] = React.useState("");
  const [nextDue, setNextDue] = React.useState("");
  const [overrides, setOverrides] = React.useState<Record<string, Disposition>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setResult("PASS");
    setDate(toDateInput(now));
    setLabour(storedLabour == null ? "" : String(storedLabour));
    setNextDue(toDateInput(storedNextDue));
    setOverrides({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const effective = (id: string): Disposition => overrides[id] ?? defaultDisposition(result);
  const retiring = assets.some((a) => effective(a.assetId) === "RETIRE");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const built = buildCompleteInput({ result, date, labour, nextDue, overrides, labourVisible, storedLabour, storedNextDue });
    if ("error" in built) return setError(built.error);
    setSaving(true);
    try {
      await onComplete(built.input);
      onOpenChange(false);
    } catch (err) {
      showError(err, { fallbackTitle: "Could not complete the job" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Complete {title}</DialogTitle>
            <DialogDescription>Record the outcome. Cost is worked out from the parts and the labour; you can undo this from the toast.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="complete-result">Result</Label>
              <Select value={result} onValueChange={(v) => setResult(v as Result)}>
                <SelectTrigger id="complete-result" aria-label="Result">
                  <SelectValue>{RESULTS.find((r) => r.value === result)?.label ?? result}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RESULTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="complete-date">Completed</Label>
              <Input id="complete-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {labourVisible ? (
              <div>
                <Label htmlFor="complete-labour">Labour ($)</Label>
                <Input id="complete-labour" type="number" min={0} step="0.01" value={labour} onChange={(e) => setLabour(e.target.value)} placeholder="Not entered" />
              </div>
            ) : null}
            <div>
              <Label htmlFor="complete-next">Next due</Label>
              <Input id="complete-next" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
            </div>
          </div>

          {assets.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-caption text-muted">What happens to each asset</legend>
              <ul className="divide-y divide-line border-y border-line">
                {assets.map((a) => (
                  <li key={a.assetId} className="flex min-h-11 items-center gap-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-table-cell text-ink"><span className="t-mono">{a.assetTag}</span> <span className="text-muted">{a.modelName}</span></span>
                    <Select value={effective(a.assetId)} onValueChange={(v) => setOverrides((o) => ({ ...o, [a.assetId]: v as Disposition }))}>
                      <SelectTrigger className="w-48" aria-label={`${a.assetTag} disposition`}>
                        <SelectValue>{DISPOSITIONS.find((d) => d.value === effective(a.assetId))?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {DISPOSITIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
              {retiring ? <p role="note" className="text-caption text-t-out">Retiring an asset is permanent, so this completion will have no Undo.</p> : null}
            </fieldset>
          ) : null}

          {error ? <p role="alert" className="text-caption text-t-out">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>Complete</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
