"use client";

import { Fragment } from "react";
import {
  ScanBarcode,
  ChevronRight,
  Package,
  Container,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { ScanInput } from "@/components/ui/scan-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { LineItem, GroupEntry } from "./warehouse-types";
import { modelDisplayName, isBulkItem, collectAllVerifiableIds, bulkUnitKey } from "./warehouse-types";
import { KitChildRows } from "./kit-child-rows";

export interface ReturnTabProps {
  // Scan state
  returnScanInputRef: React.RefObject<HTMLInputElement | null>;
  returnScanValue: string;
  setReturnScanValue: (v: string) => void;
  handleReturnScanKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  returnScanMutationMutate: (value: string) => void;
  returnScanMutationIsPending: boolean;

  // Condition & notes
  returnCondition: string;
  setReturnCondition: (v: string) => void;
  returnNotes: string;
  setReturnNotes: (v: string) => void;

  // Selection
  selectedIn: Set<string>;
  setSelectedIn: (s: Set<string>) => void;
  selectedInCount: number;
  allInKeys: string[];

  // Data
  checkedOutItems: LineItem[];
  returnContainerGroups: Array<{ container: string | null; entries: GroupEntry[] }>;

  // Kit verification
  verifiedKitItems: Set<string>;
  setVerifiedKitItems: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Expand/collapse
  expandedGroups: Set<string>;
  toggleExpanded: (key: string) => void;

  // Actions
  handleReturnSelected: () => void;
  checkInIsPending: boolean;

  // Shared helpers
  toggleSelection: (set: Set<string>, setFn: (s: Set<string>) => void, key: string) => void;
  toggleGroupSelection: (set: Set<string>, setFn: (s: Set<string>) => void, keys: string[]) => void;
  toggleAll: (set: Set<string>, setFn: (s: Set<string>) => void, allKeys: string[]) => void;
  renderGroupHeader: (
    entry: { kind: "serialized-group"; groupKey: string; modelName: string; items: LineItem[] } | { kind: "bulk-group"; groupKey: string; item: LineItem; unitCount: number },
    childKeys: string[],
    selection: Set<string>,
    setSelection: (s: Set<string>) => void,
    qtyLabel: React.ReactNode,
  ) => React.ReactNode;
}

export function ReturnTab({
  returnScanInputRef,
  returnScanValue,
  setReturnScanValue,
  handleReturnScanKeyDown,
  returnScanMutationMutate,
  returnScanMutationIsPending,
  returnCondition,
  setReturnCondition,
  returnNotes,
  setReturnNotes,
  selectedIn,
  setSelectedIn,
  selectedInCount,
  allInKeys,
  checkedOutItems,
  returnContainerGroups,
  verifiedKitItems,
  setVerifiedKitItems,
  expandedGroups,
  toggleExpanded,
  handleReturnSelected,
  checkInIsPending,
  toggleSelection,
  toggleGroupSelection,
  toggleAll,
  renderGroupHeader,
}: ReturnTabProps) {
  return (
    <TabsContent value="check-in">
      <div className="space-y-4 pt-4">
        <div className="rounded-lg bg-bg-surface surface-ring py-4 px-4 space-y-3">
            <div className="flex items-center gap-3">
              <ScanBarcode className="h-5 w-5 text-fg-3 shrink-0 hidden sm:block" />
              <div className="flex-1">
                <Label htmlFor="scan-checkin" className="sr-only">Scan asset tag</Label>
                <ScanInput
                  ref={returnScanInputRef}
                  id="scan-checkin"
                  placeholder="Scan or enter asset tag to return..."
                  value={returnScanValue}
                  onChange={(e) => setReturnScanValue(e.target.value)}
                  onKeyDown={handleReturnScanKeyDown}
                  onScan={(value) => returnScanMutationMutate(value)}
                  scannerTitle="Scan asset to return"
                  continuous
                  disabled={returnScanMutationIsPending || checkInIsPending}
                />
              </div>
              <Button
                onClick={handleReturnSelected}
                disabled={selectedInCount === 0 || checkInIsPending}
                className="shrink-0"
              >
                <span className="hidden sm:inline">Return</span>
                <span className="sm:hidden">In</span>
                {selectedInCount > 0 ? ` (${selectedInCount})` : ""}
              </Button>
            </div>
            <div className="flex items-center gap-4 pl-8">
              <div className="flex items-center gap-2">
                <Label htmlFor="return-condition" className="text-sm">Condition:</Label>
                <select
                  id="return-condition"
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="GOOD">Good</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="MISSING">Missing</option>
                </select>
              </div>
              {(returnCondition === "DAMAGED" || returnCondition === "MISSING") && (
                <div className="flex-1">
                  <Textarea
                    placeholder="Notes about damage or missing items..."
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                </div>
              )}
            </div>
        </div>

        {checkedOutItems.length === 0 ? (
          <div className="rounded-lg bg-bg-surface surface-ring py-8 text-center text-fg-3">
              <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No items currently deployed.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allInKeys.length > 0 && (allInKeys.every((k) => selectedIn.has(k)) || allInKeys.some((k) => selectedIn.has(k)))}
                      indeterminate={allInKeys.length > 0 && allInKeys.some((k) => selectedIn.has(k)) && !allInKeys.every((k) => selectedIn.has(k))}
                      onCheckedChange={() => toggleAll(selectedIn, setSelectedIn, allInKeys)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead className="text-center w-16">Qty</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnContainerGroups.map(({ container, entries }) => (
                  <Fragment key={container || "__ungrouped"}>
                    {container ? (
                      <TableRow className="bg-bg-inset/50">
                        <TableCell colSpan={5} className="py-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-2 uppercase tracking-wide">
                            <Package className="h-3.5 w-3.5" />
                            {container}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : returnContainerGroups.some((g) => g.container !== null) && (
                      <TableRow className="bg-bg-inset/30">
                        <TableCell colSpan={5} className="py-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-fg-4 uppercase tracking-wide">
                            <Package className="h-3.5 w-3.5" />
                            No Container
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {entries.map((entry) => {
                  // --- Serialized group ---
                  if (entry.kind === "serialized-group") {
                    const childKeys = entry.items.map((i) => i.id);
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedIn, setSelectedIn,
                          <TableCell>
                            <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                          </TableCell>
                        )}
                        {isExpanded && entry.items.map((item, idx) => (
                          <TableRow key={item.id} className="bg-bg-inset/30">
                            <TableCell>
                              <Checkbox
                                checked={selectedIn.has(item.id)}
                                onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                              />
                            </TableCell>
                            <TableCell className="pl-12 text-sm text-fg-3">
                              {item.asset?.assetTag ? `${item.model?.name || "Asset"}` : `Unit ${idx + 1}`}
                            </TableCell>
                            <TableCell className="font-mono text-sm text-fg-3">
                              {item.asset?.assetTag || "—"}
                            </TableCell>
                            <TableCell className="text-center">1</TableCell>
                            <TableCell>
                              <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                  }

                  // --- Bulk group ---
                  if (entry.kind === "bulk-group") {
                    const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const checkedCount = childKeys.filter((k) => selectedIn.has(k)).length;
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedIn, setSelectedIn,
                          <TableCell>
                            {checkedCount > 0 ? (
                              <Badge variant="outline" className="bg-teal-500/10 text-teal-500 border-teal-500/20">
                                {checkedCount} selected
                              </Badge>
                            ) : (
                              <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                            )}
                          </TableCell>
                        )}
                        {isExpanded && childKeys.map((key, idx) => (
                          <TableRow key={key} className="bg-bg-inset/30">
                            <TableCell>
                              <Checkbox
                                checked={selectedIn.has(key)}
                                onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, key)}
                              />
                            </TableCell>
                            <TableCell className="pl-12 text-sm text-fg-3">
                              Unit {idx + 1}
                            </TableCell>
                            <TableCell className="font-mono text-sm text-fg-3">
                              {entry.item.bulkAsset?.assetTag || "—"}
                            </TableCell>
                            <TableCell className="text-center">1</TableCell>
                            <TableCell />
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                  }

                  // --- Kit group ---
                  if (entry.kind === "kit-group") {
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allIds = collectAllVerifiableIds(entry.children, "return");
                    const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                    const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                    // Detect partial deployment: some children are deployed, others are not
                    const allChildren = (entry.item.childLineItems || []) as LineItem[];
                    const isPartiallyDeployed = allChildren.some((c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED");
                    return (
                      <Fragment key={entry.groupKey}>
                        <TableRow
                          className="cursor-pointer hover:bg-accent/50"
                          onClick={() => toggleExpanded(entry.groupKey)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIn.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, entry.item.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <ChevronRight className={`h-4 w-4 text-fg-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              <Container className="h-4 w-4 text-fg-3" />
                              <span className="font-medium">{entry.item.description || entry.item.kit?.name || "Kit"}</span>
                              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                                Kit
                              </Badge>
                              {allIds.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className={allVerified
                                    ? "ml-1 text-[10px] px-1.5 py-0 bg-green-500/10 text-green-500 border-green-500/20"
                                    : verifiedCount > 0
                                      ? "ml-1 text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border-amber-500/20"
                                      : "ml-1 text-[10px] px-1.5 py-0"
                                  }
                                >
                                  {verifiedCount}/{allIds.length} verified
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-fg-3">
                            {entry.item.kit?.assetTag || "—"}
                          </TableCell>
                          <TableCell className="text-center">{entry.children.length}</TableCell>
                          <TableCell>
                            {isPartiallyDeployed ? (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                                Partial
                              </Badge>
                            ) : (
                              <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <KitChildRows
                            kitChildren={entry.children}
                            verifiedKitItems={verifiedKitItems}
                            expandedGroups={expandedGroups}
                            toggleExpanded={toggleExpanded}
                            mode="return"
                            onToggleVerify={(assetId) => {
                              setVerifiedKitItems((prev) => {
                                const next = new Set(prev);
                                if (next.has(assetId)) next.delete(assetId);
                                else next.add(assetId);
                                return next;
                              });
                            }}
                          />
                        )}
                      </Fragment>
                    );
                  }

                  // --- Single item ---
                  const item = entry.item;
                  const isBulk = isBulkItem(item);
                  const assetTag = item.asset?.assetTag || item.bulkAsset?.assetTag || null;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIn.has(item.id)}
                          onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{modelDisplayName(item)}</span>
                        {item.subHireId != null && (
                          <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-600 border-cyan-500/20">Subhire</Badge>
                        )}
                        {item.isCustomItem && (
                          <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-muted text-fg-3 border-border/60">Custom</Badge>
                        )}
                        {item.subHireId != null && item.supplier && (
                          <p className="text-xs text-fg-3 mt-0.5">via {item.supplier.name}</p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-fg-3">
                        {assetTag || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {isBulk ? (
                          <span>
                            <span className={item.returnedQuantity > 0 ? "font-semibold text-teal-600" : ""}>
                              {item.returnedQuantity}
                            </span>
                            <span className="text-fg-3">/{item.checkedOutQuantity}</span>
                          </span>
                        ) : (
                          <span>1</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                      </TableCell>
                    </TableRow>
                  );
                })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </TabsContent>
  );
}
