"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useReactiveServerQuery } from "@/hooks/use-reactive-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useStocktakeVersion } from "@/hooks/use-stocktake";
import {
  Camera,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Pencil,
  Search,
  SquareCheck,
  Info,
  Circle,
} from "lucide-react";
import { toast } from "sonner";

import {
  scanStocktakeItem,
  searchStocktakeAssets,
  markStocktakeItemFound,
  unmarkStocktakeItemFound,
  getStocktakeProgress,
  getRecentScans,
  completeScanning,
  updateBulkCount,
} from "@/server/stocktake";
import { useActiveOrganization } from "@/lib/auth-client";
import { BarcodeScanner } from "@/components/ui/barcode-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface StocktakeScannerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stocktake: Record<string, any>;
  onUpdate: () => void;
}

export function StocktakeScanner({
  stocktake,
  onUpdate,
}: StocktakeScannerProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [bulkEntry, setBulkEntry] = useState<{
    itemId: string;
    name: string;
    expected: number;
  } | null>(null);
  const [bulkQuantity, setBulkQuantity] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reactive trigger: a cheap Convex "version vector" that changes whenever any
  // item of this stocktake changes (dual-written). It drives re-runs of the three
  // unchanged server actions below — replacing the old 3–5s polling with a Convex
  // push, and making the scanner cross-user live. See convex/stocktakeDetail.ts.
  const version = useStocktakeVersion(stocktake.id);

  // Progress tally
  const { data: progress, refetch: refetchProgress } = useReactiveServerQuery({
    watch: version,
    queryKey: ["stocktake-progress", orgId, stocktake.id],
    queryFn: () => getStocktakeProgress(stocktake.id),
  });

  // Recent scans
  const { data: recentScans, refetch: refetchRecent } = useReactiveServerQuery({
    watch: version,
    queryKey: ["stocktake-recent", orgId, stocktake.id],
    queryFn: () => getRecentScans(stocktake.id),
  });

  // Search results — also keyed by the debounced query, gated until 2+ chars.
  // Watching the version re-runs the search after a scan (preserving the old
  // post-scan search invalidation) while an open popover stays fresh.
  const { data: searchResults, isLoading: isSearching, refetch: refetchSearch } = useReactiveServerQuery({
    watch: version,
    queryKey: ["stocktake-search", orgId, stocktake.id, debouncedQuery],
    queryFn: () => searchStocktakeAssets(stocktake.id, debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  // Same-view immediacy after a write: re-read the server actions now rather than
  // waiting for the mirror write + version push to land. The version push that
  // follows is a harmless no-op refresh.
  const refreshLive = useCallback(() => {
    refetchProgress();
    refetchRecent();
    refetchSearch();
  }, [refetchProgress, refetchRecent, refetchSearch]);

  const scanMutation = useServerMutation({
    mutationFn: (assetTag: string) =>
      scanStocktakeItem({ stocktakeId: stocktake.id, assetTag }),
    onSuccess: (result) => {
      refreshLive();
      if (result.alreadyScanned) {
        toast.info("Already scanned");
        return;
      }
      if (result.isExpected) {
        toast.success("Item found");
      } else {
        toast("Unexpected item", {
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
          description: "This item was not expected at this location.",
        });
      }

      // If it's a bulk asset, prompt for quantity
      if (result.bulkAssetId && result.isExpected) {
        setBulkEntry({
          itemId: result.id,
          name:
            result.bulkAsset?.model?.name ??
            result.bulkAsset?.assetTag ??
            "Bulk Asset",
          expected: result.expectedQuantity,
        });
        setBulkQuantity(String(result.expectedQuantity));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const markFoundMutation = useServerMutation({
    mutationFn: markStocktakeItemFound,
    onSuccess: (result) => {
      refreshLive();
      toast.success("Marked as found");
      // If bulk asset, prompt for quantity
      if (result.bulkAssetId) {
        setBulkEntry({
          itemId: result.id,
          name:
            result.bulkAsset?.model?.name ??
            result.bulkAsset?.assetTag ??
            "Bulk Asset",
          expected: result.expectedQuantity,
        });
        setBulkQuantity(String(result.expectedQuantity));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const unmarkFoundMutation = useServerMutation({
    mutationFn: unmarkStocktakeItemFound,
    onSuccess: () => {
      refreshLive();
      toast.success("Unmarked");
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkCountMutation = useServerMutation({
    mutationFn: (data: { itemId: string; quantity: number }) =>
      updateBulkCount(data),
    onSuccess: () => {
      toast.success("Quantity updated");
      setBulkEntry(null);
      setBulkQuantity("");
      refreshLive();
    },
    onError: (e) => toast.error(e.message),
  });

  const completeMutation = useServerMutation({
    mutationFn: () => completeScanning(stocktake.id),
    onSuccess: () => {
      toast.success("Scanning complete — ready for review");
      onUpdate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleScan = useCallback(
    (value: string) => {
      scanMutation.mutate(value.trim());
    },
    [scanMutation],
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    scanMutation.mutate(searchQuery.trim());
    setSearchQuery("");
    searchInputRef.current?.focus();
  };

  const foundCount = progress?.foundCount ?? 0;
  const expectedCount = progress?.expectedCount ?? stocktake.expectedCount;
  const progressPercent =
    expectedCount > 0 ? Math.round((foundCount / expectedCount) * 100) : 0;

  const showSearchResults =
    debouncedQuery.length >= 2 && (searchResults || isSearching);
  const popoverOpen = searchFocused && !!showSearchResults;

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {stocktake.name}
          </h1>
          <p className="text-muted-foreground">
            Scanning at {stocktake.location?.name}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          render={<Link href={`/warehouse/stocktake/${stocktake.id}/edit`} />}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>

      {/* Progress bar */}
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-2xl font-bold tabular-nums">
              {foundCount}{" "}
              <span className="text-muted-foreground text-base font-normal">
                / {expectedCount}
              </span>
            </span>
          </div>
          <div className="bg-secondary h-3 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {progressPercent}% complete
          </p>
      </div>

      {/* Scan button */}
      <Button
        className="w-full"
        size="lg"
        onClick={() => setScannerOpen(true)}
      >
        <Camera className="mr-2 h-5 w-5" />
        Scan Barcode
      </Button>

      {/* Search with popover dropdown */}
      <div className="relative">
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search by asset tag, model name, serial number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={(e) => {
              // Don't close if clicking inside the popover
              if (popoverRef.current?.contains(e.relatedTarget as Node)) return;
              setSearchFocused(false);
            }}
            className="pl-9"
          />
        </form>

        {popoverOpen && (
          <div
            ref={popoverRef}
            className="absolute top-full left-0 right-0 z-[100] mt-1 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
              <div className="max-h-72 overflow-y-auto p-1">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(() => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const results = searchResults as any[] | undefined;
                  if (!results || (isSearching && results.length === 0)) {
                    return (
                      <div className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Searching...
                      </div>
                    );
                  }
                  if (results.length === 0) {
                    return (
                      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                        No items match &ldquo;{debouncedQuery}&rdquo;
                      </div>
                    );
                  }
                  return results.map((item) => {
                    const assetTag =
                      item.asset?.assetTag ??
                      item.bulkAsset?.assetTag ??
                      "Unknown";
                    const modelName =
                      item.asset?.model?.name ??
                      item.bulkAsset?.model?.name ??
                      "";
                    const serialNumber = item.asset?.serialNumber;
                    const isFound = item.found as boolean;
                    const isBulk = !!item.bulkAssetId;
                    const isPending =
                      markFoundMutation.isPending || unmarkFoundMutation.isPending;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent hover:text-accent-foreground outline-hidden"
                        disabled={isPending}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (isFound) {
                            unmarkFoundMutation.mutate(item.id);
                          } else {
                            markFoundMutation.mutate(item.id);
                          }
                        }}
                      >
                        <span className="shrink-0">
                          {isFound ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {assetTag}
                            {serialNumber && (
                              <span className="text-muted-foreground font-normal ml-2">
                                SN: {serialNumber}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {modelName}
                            {isBulk && (
                              <span className="ml-2">
                                · Expected: {item.expectedQuantity}
                              </span>
                            )}
                          </p>
                        </div>
                        {isBulk && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            Bulk
                          </Badge>
                        )}
                        {isFound && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-green-500 border-green-500/20"
                          >
                            Found
                          </Badge>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
          </div>
        )}
      </div>

      {/* Bulk quantity entry */}
      {bulkEntry && (
        <div className="rounded-lg bg-amber-500/5 p-5 surface-ring sm:p-6">
          <h3 className="t-heading text-fg flex items-center gap-2 mb-3">
            <Info className="h-4 w-4" />
            Enter counted quantity
          </h3>
            <p className="text-sm text-muted-foreground mb-2">
              {bulkEntry.name} — expected: {bulkEntry.expected}
            </p>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={bulkQuantity}
                onChange={(e) => setBulkQuantity(e.target.value)}
                className="w-24"
                autoFocus
              />
              <Button
                size="sm"
                onClick={() =>
                  bulkCountMutation.mutate({
                    itemId: bulkEntry.itemId,
                    quantity: parseInt(bulkQuantity) || 0,
                  })
                }
                disabled={bulkCountMutation.isPending}
              >
                {bulkCountMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Confirm"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBulkEntry(null)}
              >
                Skip
              </Button>
            </div>
        </div>
      )}

      {/* Recently scanned */}
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <h3 className="t-heading text-fg mb-3">Recently Scanned</h3>
          {!recentScans || recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No items scanned yet. Scan a barcode or search to find items.
            </p>
          ) : (
            <div className="divide-y">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {recentScans.map((item: any) => {
                const assetTag =
                  item.asset?.assetTag ??
                  item.bulkAsset?.assetTag ??
                  "Unknown";
                const modelName =
                  item.asset?.model?.name ??
                  item.bulkAsset?.model?.name ??
                  "";
                const isExpected = item.expectedAtLocation as boolean;

                return (
                  <div
                    key={item.id as string}
                    className="flex items-center gap-3 py-2"
                  >
                    {isExpected ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {assetTag as string}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {modelName as string}
                      </p>
                    </div>
                    {!isExpected && (
                      <Badge
                        variant="outline"
                        className="shrink-0 text-amber-500 border-amber-500/20"
                      >
                        Unexpected
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Complete scanning button */}
      <Button
        variant="outline"
        className="w-full"
        size="lg"
        onClick={() => completeMutation.mutate()}
        disabled={completeMutation.isPending}
      >
        {completeMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <SquareCheck className="mr-2 h-5 w-5" />
        )}
        Complete Scanning
      </Button>

      {/* Barcode scanner modal */}
      <BarcodeScanner
        open={scannerOpen}
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
        title="Stocktake Scan"
        continuous
      />
    </div>
  );
}
