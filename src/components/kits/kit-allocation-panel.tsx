"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, RotateCcw, Scale, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CanDo } from "@/components/auth/permission-gate";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { getKitAllocation, saveKitAllocation, clearKitAllocation } from "@/server/kit-allocations";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { KitAllocationView } from "@/lib/validations/kit-allocation";

/**
 * Kit revenue allocation — decide how a kit's price is split across the models
 * inside it, so per-model ROI is answerable. See docs/revenue-allocation-design.md.
 *
 * The panel opens on a cost-weighted suggestion that already totals 100.00, so the
 * happy path is "Save" and nothing else.
 */

const pct = (n: number) => `${n.toFixed(2)}%`;

/** Percent inputs are edited as text so a half-typed "1." doesn't snap to 1. */
type Draft = Record<string, string>;

const toNumber = (s: string): number => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const draftFrom = (view: KitAllocationView): Draft =>
  Object.fromEntries(
    view.rows.map((r) => [
      r.modelId,
      // A saved-but-stale allocation is shown as saved, with the banner explaining
      // why bookings currently ignore it. Silently swapping in the suggestion would
      // hide the drift the banner exists to surface.
      (r.allocationPercent ?? r.suggestedPercent).toFixed(2),
    ]),
  );

export function KitAllocationPanel({ kitId }: { kitId: string }) {
  const { data, isLoading, refetch } = useServerQuery({
    queryKey: ["kit-allocation", kitId],
    queryFn: () => getKitAllocation(kitId) as Promise<KitAllocationView>,
  });

  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="Nothing to allocate yet"
        description="Add serialized or bulk items to this kit, then split its price across the models inside it."
      />
    );
  }

  // Remount the editor whenever the server's answer changes, so the draft is
  // initialised from props rather than synced into state by an effect. A save (or
  // someone else's edit) resets the form to what was actually stored.
  return (
    <AllocationEditor
      key={serverSignature(data)}
      kitId={kitId}
      view={data}
      onSaved={refetch}
    />
  );
}

const serverSignature = (v: KitAllocationView): string =>
  v.rows.map((r) => `${r.modelId}:${r.allocationPercent ?? "~"}:${r.suggestedPercent}`).join("|");

function AllocationEditor({
  kitId,
  view: data,
  onSaved,
}: {
  kitId: string;
  view: KitAllocationView;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(data));
  const [dirty, setDirty] = useState(false);

  const total = useMemo(
    () => Object.values(draft).reduce((s, v) => s + toNumber(v), 0),
    [draft],
  );
  const balanced = Math.abs(total - 100) <= 0.01;

  const setRow = useCallback((modelId: string, value: string) => {
    setDraft((d) => ({ ...d, [modelId]: value }));
    setDirty(true);
  }, []);

  const save = useServerMutation({
    mutationFn: () =>
      saveKitAllocation(
        kitId,
        Object.entries(draft).map(([modelId, v]) => ({
          modelId,
          allocationPercent: Math.round(toNumber(v) * 100) / 100,
        })),
      ),
    onSuccess: () => {
      toast.success("Revenue allocation saved");
      setDirty(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clear = useServerMutation({
    mutationFn: () => clearKitAllocation(kitId),
    onSuccess: () => {
      toast.success("Allocation cleared — bookings will fall back to cost weighting");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetToSuggested = useCallback(() => {
    setDraft(
      Object.fromEntries(data.rows.map((r) => [r.modelId, r.suggestedPercent.toFixed(2)])),
    );
    setDirty(true);
  }, [data]);

  /**
   * Push the whole shortfall/excess onto the largest row rather than smearing it.
   * Nudging every row by 0.03% to fix a rounding gap makes the user's own numbers
   * unrecognisable; moving one row keeps the split theirs.
   */
  const autoBalance = useCallback(() => {
    const gap = Math.round((100 - total) * 100) / 100;
    if (gap === 0) return;
    const target = [...data.rows]
      .map((r) => ({ id: r.modelId, v: toNumber(draft[r.modelId] ?? "0") }))
      .sort((a, b) => b.v - a.v)[0];
    setDraft((d) => ({
      ...d,
      [target.id]: Math.max(0, Math.round((target.v + gap) * 100) / 100).toFixed(2),
    }));
    setDirty(true);
  }, [data, draft, total]);

  return (
    <div className="space-y-4">
      <p className="text-ui-text text-muted">
        When this kit is booked at a fixed price, its revenue is split across the models
        inside it so each one&rsquo;s ROI can be measured. Applies to{" "}
        <strong className="text-ink-2">future bookings</strong> — projects already
        priced keep the split they were booked with.
      </p>

      {data.isStale && (
        <div className="flex gap-3 rounded-md border border-warn/40 bg-warn-soft p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div className="space-y-1">
            <p className="text-ui-text text-ink">Allocation is out of date</p>
            <p className="text-caption text-muted">
              This kit&rsquo;s contents changed since the split was saved
              {data.orphanedModelIds.length > 0
                ? ` (${data.orphanedModelIds.length} model${data.orphanedModelIds.length === 1 ? "" : "s"} no longer in the kit)`
                : ""}
              . Bookings currently fall back to weighting by replacement cost. Review
              the percentages below and save to use them again.
            </p>
          </div>
        </div>
      )}

      {/* overflow-x-auto, not overflow-hidden: six columns clip rather than scroll on a phone. */}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b border-line bg-paper-2">
              <th className="px-3 py-2 text-left text-caption text-muted">Model</th>
              <th className="px-3 py-2 text-right text-caption text-muted">Qty</th>
              <th className="px-3 py-2 text-right text-caption text-muted">Replacement cost</th>
              <th className="px-3 py-2 text-right text-caption text-muted">Suggested</th>
              <th className="w-32 px-3 py-2 text-right text-caption text-muted">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.modelId} className="border-b border-line last:border-0">
                <td className="px-3 py-2 text-table-cell text-ink">{r.modelName}</td>
                <td className="px-3 py-2 text-right text-table-cell tabular-nums text-ink-2">
                  {r.quantity}
                </td>
                <td className="px-3 py-2 text-right text-table-cell tabular-nums text-muted">
                  {r.replacementCost != null ? formatCurrency(r.replacementCost) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-table-cell tabular-nums text-faint">
                  {pct(r.suggestedPercent)}
                </td>
                <td className="px-3 py-2">
                  <CanDo
                    resource="kit"
                    action="update"
                    fallback={
                      <span className="block text-right text-table-cell tabular-nums text-ink">
                        {pct(toNumber(draft[r.modelId] ?? "0"))}
                      </span>
                    }
                  >
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`Revenue share for ${r.modelName}`}
                      value={draft[r.modelId] ?? ""}
                      onChange={(e) => setRow(r.modelId, e.target.value)}
                      className="h-8 text-right tabular-nums"
                    />
                  </CanDo>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-paper-2">
              <td colSpan={4} className="px-3 py-2 text-right text-ui-text text-muted">
                Total
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right text-ui-text tabular-nums",
                  balanced ? "text-ok" : "text-warn",
                )}
              >
                {pct(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!balanced && (
        <p className="text-caption text-warn">
          Must total 100% to save — currently {total > 100 ? "over" : "under"} by{" "}
          {pct(Math.abs(100 - total))}.
        </p>
      )}

      <CanDo resource="kit" action="update">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => save.mutate(undefined)}
            disabled={!balanced || !dirty || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save allocation"}
          </Button>
          <Button size="sm" variant="line" onClick={autoBalance} disabled={balanced}>
            <Scale className="h-4 w-4" />
            Auto-balance
          </Button>
          <Button size="sm" variant="line" onClick={resetToSuggested}>
            <Wand2 className="h-4 w-4" />
            Use suggested
          </Button>
          {data.hasAllocation && (
            <Button
              size="sm"
              variant="line"
              className="ml-auto text-muted"
              onClick={() => clear.mutate(undefined)}
              disabled={clear.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </CanDo>
    </div>
  );
}
