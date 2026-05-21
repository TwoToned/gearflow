"use client";

/**
 * Reorder dashboard (Wave 3).
 *
 * Closes the supply-chain loop: stocktake / damage / consumption surfaces
 * low stock here. Operator picks items, the page generates one DRAFT
 * SupplierOrder per supplier with the items pre-filled. Edit the draft
 * in /suppliers/orders/[id] to finalise + send.
 *
 * Grouping: items without a preferred supplier go into an "Unassigned"
 * group so they're visible. Assign a supplier on the BulkAsset edit form
 * to make them route correctly.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  AlertTriangle,
  Package,
  ShoppingCart,
  Truck,
  Loader2,
  ArrowRight,
} from "lucide-react";

import { getReorderCandidates, createReorderDraft } from "@/server/reorder";
import type { ReorderCandidate } from "@/lib/reorder";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { formatCurrency } from "@/lib/formatters";
import { showError } from "@/lib/show-error";
import { cn } from "@/lib/utils";

interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  items: ReorderCandidate[];
}

function ReorderContent() {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["reorder-candidates", orgId],
    queryFn: () => getReorderCandidates(),
    enabled: !!orgId,
  });

  // Per-row overrides — operator can edit the suggested quantity.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groups = useMemo<SupplierGroup[]>(() => {
    const c = (candidates ?? []) as ReorderCandidate[];
    const map = new Map<string, SupplierGroup>();
    for (const item of c) {
      const key = item.preferredSupplier?.id ?? "__none__";
      const name = item.preferredSupplier?.name ?? "Unassigned — set a preferred supplier first";
      if (!map.has(key)) {
        map.set(key, {
          supplierId: item.preferredSupplier?.id ?? null,
          supplierName: name,
          items: [],
        });
      }
      map.get(key)!.items.push(item);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.supplierId == null ? 1 : b.supplierId == null ? -1 : a.supplierName.localeCompare(b.supplierName),
    );
  }, [candidates]);

  const createDraftMutation = useMutation({
    mutationFn: createReorderDraft,
    onSuccess: (result) => {
      toast.success(`Created draft ${result.orderNumber}`, {
        description: `${result.lineCount} line${result.lineCount === 1 ? "" : "s"} — edit and send from Supplier Orders.`,
      });
      queryClient.invalidateQueries({ queryKey: ["reorder-candidates"] });
      // Clear selections for the items we just ordered
      setSelected((prev) => {
        const next = new Set(prev);
        for (const [id] of Object.entries(quantities)) next.delete(id);
        return next;
      });
    },
    onError: (e) => showError(e),
  });

  function toggleSelection(item: ReorderCandidate) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.bulkAssetId)) {
        next.delete(item.bulkAssetId);
      } else {
        next.add(item.bulkAssetId);
        // Seed default quantity when first selected
        setQuantities((q) =>
          q[item.bulkAssetId] != null
            ? q
            : { ...q, [item.bulkAssetId]: item.suggestedOrderQuantity },
        );
      }
      return next;
    });
  }

  function setQty(itemId: string, qty: number) {
    setQuantities((q) => ({ ...q, [itemId]: Math.max(1, Math.floor(qty || 1)) }));
  }

  function selectAllInGroup(group: SupplierGroup) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of group.items) {
        next.add(it.bulkAssetId);
      }
      return next;
    });
    setQuantities((q) => {
      const next = { ...q };
      for (const it of group.items) {
        if (next[it.bulkAssetId] == null) {
          next[it.bulkAssetId] = it.suggestedOrderQuantity;
        }
      }
      return next;
    });
  }

  function createDraftForGroup(group: SupplierGroup) {
    if (!group.supplierId) {
      toast.error("Unassigned items can't be ordered", {
        description: "Set a preferred supplier on each item first (edit the bulk asset).",
      });
      return;
    }
    const lines = group.items
      .filter((it) => selected.has(it.bulkAssetId))
      .map((it) => ({
        bulkAssetId: it.bulkAssetId,
        quantity: quantities[it.bulkAssetId] ?? it.suggestedOrderQuantity,
        unitPrice: it.purchasePricePerUnit ?? undefined,
      }));

    if (lines.length === 0) {
      toast.error("Nothing selected", {
        description: `Tick at least one row in the ${group.supplierName} group.`,
      });
      return;
    }
    createDraftMutation.mutate({ supplierId: group.supplierId, lines });
  }

  const totalCount = (candidates ?? []).length;
  const selectedCount = selected.size;

  return (
    <FadeIn className="space-y-4">
      <PageHeader
        title="Reorder"
        description={
          totalCount === 0
            ? "Nothing's below its reorder threshold. The page lights up when stock dips."
            : `${totalCount} bulk item${totalCount === 1 ? "" : "s"} at or below their reorder threshold.`
        }
      />

      {/* Helper card explaining the setup */}
      {totalCount === 0 && !isLoading && (
        <div className="rounded-md border bg-bg-surface p-4 text-sm text-fg-3">
          <p>
            To populate this page, set a <strong>reorder threshold</strong> on
            bulk assets (gels, cables, batteries, gaff, anything you buy in
            quantity). When availability dips at or below the threshold, items
            show up here grouped by their <strong>preferred supplier</strong>.
          </p>
          <p className="mt-2">
            Both fields live on the bulk asset edit form.
          </p>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="sticky top-0 z-10 rounded-md border bg-bg-surface px-3 py-2 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {selectedCount} item{selectedCount === 1 ? "" : "s"} selected
            </span>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-fg-3">Loading…</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const groupSelected = group.items.filter((it) => selected.has(it.bulkAssetId));
            const isUnassigned = group.supplierId == null;
            return (
              <div key={group.supplierId ?? "none"} className="rounded-md border bg-bg-surface">
                {/* Group header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Truck className="size-4 text-fg-3" />
                    <span className="text-sm font-semibold">{group.supplierName}</span>
                    <Badge variant="outline">{group.items.length}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isUnassigned && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => selectAllInGroup(group)}
                      >
                        Select all
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={
                        isUnassigned ||
                        createDraftMutation.isPending ||
                        groupSelected.length === 0
                      }
                      onClick={() => createDraftForGroup(group)}
                    >
                      {createDraftMutation.isPending && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      )}
                      <ShoppingCart className="mr-1.5 size-3.5" />
                      Create draft ({groupSelected.length})
                    </Button>
                  </div>
                </div>

                {/* Items */}
                <div className="divide-y">
                  {group.items.map((item) => {
                    const isSelected = selected.has(item.bulkAssetId);
                    const qty = quantities[item.bulkAssetId] ?? item.suggestedOrderQuantity;
                    const subtotal = item.purchasePricePerUnit != null
                      ? qty * item.purchasePricePerUnit
                      : null;
                    return (
                      <div
                        key={item.bulkAssetId}
                        className={cn(
                          "flex flex-wrap items-center gap-3 px-3 py-2.5 transition-colors",
                          isSelected && "bg-bg-inset/40",
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          disabled={isUnassigned}
                          onCheckedChange={() => toggleSelection(item)}
                          aria-label="Select item"
                        />
                        <Package className="size-4 shrink-0 text-fg-4" />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/assets/registry/${item.bulkAssetId}`}
                            className="block text-sm font-medium hover:underline"
                          >
                            {item.modelName}
                          </Link>
                          <div className="text-xs text-fg-4">
                            {item.assetTag}
                            {item.categoryName ? ` · ${item.categoryName}` : ""}
                            {item.locationName ? ` · ${item.locationName}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs">
                          <span
                            className={cn(
                              "rounded-sm px-1.5 py-0.5 font-medium tabular-nums",
                              item.availableQuantity === 0
                                ? "bg-red-500/10 text-red-600"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                            )}
                          >
                            {item.availableQuantity} / {item.totalQuantity}
                          </span>
                          <span className="text-fg-4">
                            threshold {item.reorderThreshold}
                          </span>
                        </div>
                        {item.lastReorderedAt && (
                          <span className="text-[11px] text-fg-4">
                            ordered {formatDistanceToNow(new Date(item.lastReorderedAt))} ago
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            value={qty}
                            disabled={!isSelected}
                            onChange={(e) => setQty(item.bulkAssetId, Number(e.target.value))}
                            className="h-8 w-20 text-right text-sm tabular-nums"
                            aria-label="Reorder quantity"
                          />
                          {subtotal != null && (
                            <span className="text-xs text-fg-4 tabular-nums">
                              ≈ {formatCurrency(subtotal)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-fg-4">
          <AlertTriangle className="size-3" />
          Drafts land in <Link href="/suppliers" className="underline-offset-2 hover:underline inline-flex items-center gap-0.5">Suppliers <ArrowRight className="size-3" /></Link>
          — edit lines, set price, then send to the supplier.
        </div>
      )}
    </FadeIn>
  );
}

export default function ReorderPage() {
  return (
    <RequirePermission resource="bulkAsset" action="read">
      <ReorderContent />
    </RequirePermission>
  );
}
