"use client";

import { Fragment } from "react";
import {
  ScanBarcode,
  ChevronRight,
  Package,
  Undo2,
  Container,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { focusRing } from "@/lib/utils";
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
import { KitChildRows, MobileKitChildCards } from "./kit-child-rows";
import { ScanItemCard, ScanGroupCard, ScanContainerHeading } from "./scan-card";

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
  /** Move the selected deployed units back to Prepped (un-deploy). */
  handleUndeploy: (ids: Set<string>) => void;
  undeployIsPending: boolean;

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
  handleUndeploy,
  undeployIsPending,
  toggleSelection,
  toggleGroupSelection,
  toggleAll,
  renderGroupHeader,
}: ReturnTabProps) {
  return (
    <TabsContent value="check-in">
      <div className="space-y-4 pt-4">
        <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] py-4 px-4 space-y-3">
            <div className="flex items-center gap-3">
              <ScanBarcode className="h-5 w-5 text-muted shrink-0 hidden sm:block" />
              <div className="flex-1">
                <Label htmlFor="scan-checkin" className="sr-only">Scan asset tag</Label>
                <AssetTagInput
                  ref={returnScanInputRef}
                  id="scan-checkin"
                  placeholder="Scan or enter asset tag to return..."
                  value={returnScanValue}
                  onChange={(e) => setReturnScanValue(e.target.value)}
                  onKeyDown={handleReturnScanKeyDown}
                  onScan={(value) => returnScanMutationMutate(value)}
                  disabled={returnScanMutationIsPending || checkInIsPending}
                  className="h-11"
                />
              </div>
              {/* Move back a stage — return this gear to Prepped (un-deploy). */}
              <Button
                variant="line"
                onClick={() => handleUndeploy(selectedIn)}
                disabled={selectedInCount === 0 || undeployIsPending || checkInIsPending}
                loading={undeployIsPending}
                className="shrink-0"
              >
                <Undo2 className="mr-1.5 h-4 w-4" />
                <span className="hidden sm:inline">Move to Prepped</span>
                <span className="sm:hidden">Prep</span>
                {selectedInCount > 0 ? ` (${selectedInCount})` : ""}
              </Button>
              <Button
                onClick={handleReturnSelected}
                disabled={selectedInCount === 0 || checkInIsPending || undeployIsPending}
                loading={checkInIsPending}
                className="shrink-0"
              >
                <span className="hidden sm:inline">Return</span>
                <span className="sm:hidden">In</span>
                {selectedInCount > 0 ? ` (${selectedInCount})` : ""}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4 pl-8">
              <div className="flex items-center gap-2">
                <Label htmlFor="return-condition" className="text-ui-text">Condition:</Label>
                <select
                  id="return-condition"
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value)}
                  className={`flex h-11 rounded-[var(--r)] border-2 border-border bg-transparent px-3 py-1 text-ui-text text-ink ${focusRing}`}
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
                    className="text-ui-text"
                  />
                </div>
              )}
            </div>
        </div>

        {checkedOutItems.length === 0 ? (
          <EmptyState
            title="Nothing out on this project"
            description="Deployed gear shows here, ready to scan back in."
          />
        ) : (
          <>
          {/* Desktop: data table */}
          <div className="hidden md:block rounded-[var(--r-lg)] border border-line overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all items"
                      checked={
                        allInKeys.length === 0
                          ? false
                          : allInKeys.every((k) => selectedIn.has(k))
                            ? true
                            : allInKeys.some((k) => selectedIn.has(k))
                              ? "indeterminate"
                              : false
                      }
                      onCheckedChange={() => toggleAll(selectedIn, setSelectedIn, allInKeys)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset tag</TableHead>
                  <TableHead className="text-center w-16">Qty</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnContainerGroups.map(({ container, entries }) => (
                  <Fragment key={container || "__ungrouped"}>
                    {container ? (
                      <TableRow className="bg-paper-2/60">
                        <TableCell colSpan={5} className="py-1.5">
                          <div className="flex items-center gap-1.5 text-caption font-semibold text-ink-2">
                            <Package className="h-3.5 w-3.5" />
                            {container}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : returnContainerGroups.some((g) => g.container !== null) && (
                      <TableRow className="bg-paper-2/40">
                        <TableCell colSpan={5} className="py-1.5">
                          <div className="flex items-center gap-1.5 text-caption font-medium text-faint">
                            <Package className="h-3.5 w-3.5" />
                            No container
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
                          <Fragment key={item.id}>
                            <TableRow className="bg-paper-2/40">
                              <TableCell>
                                <Checkbox
                                  aria-label="Select item"
                                  checked={selectedIn.has(item.id)}
                                  onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                                />
                              </TableCell>
                              <TableCell className="pl-12 text-table-cell text-muted">
                                {item.asset?.assetTag ? `${item.model?.name || "Asset"}` : `Unit ${idx + 1}`}
                              </TableCell>
                              <TableCell className="t-mono text-muted">
                                {item.asset?.assetTag || "—"}
                              </TableCell>
                              <TableCell className="text-center tabular-nums">1</TableCell>
                              <TableCell>
                                <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        ))}
                      </Fragment>
                    );
                  }

                  // --- Bulk group ---
                  if (entry.kind === "bulk-group") {
                    const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const checkedCount = childKeys.filter((k) => selectedIn.has(k)).length;
                    // Render per-unit asset tags from the fulfillment
                    // units. Pre-cutover this column was always the
                    // line-level bulkAsset tag (null for serialised
                    // multi-quantity lines).
                    const units = entry.item.units ?? [];
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedIn, setSelectedIn,
                          <TableCell>
                            {checkedCount > 0 ? (
                              <Badge status="neutral" className="bg-blue-soft text-blue">
                                {checkedCount} selected
                              </Badge>
                            ) : (
                              <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                            )}
                          </TableCell>
                        )}
                        {isExpanded && childKeys.map((key, idx) => {
                          const unit = units[idx];
                          const tag = unit?.asset?.assetTag
                            ?? unit?.bulkAsset?.assetTag
                            ?? entry.item.bulkAsset?.assetTag
                            ?? "—";
                          return (
                            <TableRow key={key} className="bg-paper-2/40">
                              <TableCell>
                                <Checkbox
                                  aria-label="Select item"
                                  checked={selectedIn.has(key)}
                                  onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, key)}
                                />
                              </TableCell>
                              <TableCell className="pl-12 text-table-cell text-muted">
                                Unit {idx + 1}
                              </TableCell>
                              <TableCell className="t-mono text-muted">
                                {tag}
                              </TableCell>
                              <TableCell className="text-center tabular-nums">1</TableCell>
                              <TableCell />
                            </TableRow>
                          );
                        })}
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
                          className={`cursor-pointer hover:bg-elev ${focusRing}`}
                          onClick={() => toggleExpanded(entry.groupKey)}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleExpanded(entry.groupKey);
                            }
                          }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label="Select item"
                              checked={selectedIn.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, entry.item.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <ChevronRight className={`h-4 w-4 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              <Container className="h-4 w-4 text-muted" />
                              <span className="font-medium text-ink">{entry.item.description || entry.item.kit?.name || "Kit"}</span>
                              <Badge status="neutral" className="ml-1">
                                Kit
                              </Badge>
                              {allIds.length > 0 && (
                                <Badge
                                  status={allVerified ? "ok" : verifiedCount > 0 ? "warn" : "neutral"}
                                  className="ml-1 tabular-nums"
                                >
                                  {verifiedCount}/{allIds.length} verified
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="t-mono text-muted">
                            {entry.item.kit?.assetTag || "—"}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">{entry.children.length}</TableCell>
                          <TableCell>
                            {isPartiallyDeployed ? (
                              <Badge status="warn">
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
                    <Fragment key={item.id}>
                    <TableRow>
                      <TableCell>
                        <Checkbox
                          aria-label="Select item"
                          checked={selectedIn.has(item.id)}
                          onCheckedChange={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-ink">{modelDisplayName(item)}</span>
                        {item.subHireId != null && (
                          <Badge status="neutral" className="ml-1.5 bg-blue-soft text-blue">Subhire</Badge>
                        )}
                        {item.isCustomItem && (
                          <Badge status="neutral" className="ml-1.5">Custom</Badge>
                        )}
                        {item.subHireId != null && item.supplier && (
                          <p className="text-caption text-muted mt-0.5">via {item.supplier.name}</p>
                        )}
                      </TableCell>
                      <TableCell className="t-mono text-muted">
                        {assetTag || "—"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {isBulk ? (
                          <span>
                            <span className={item.returnedQuantity > 0 ? "font-semibold text-ok" : ""}>
                              {item.returnedQuantity}
                            </span>
                            <span className="text-muted">/{item.checkedOutQuantity}</span>
                          </span>
                        ) : (
                          <span>1</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                      </TableCell>
                    </TableRow>
                    </Fragment>
                  );
                })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: card list (§15) — same grouped data + handlers */}
          <div className="md:hidden space-y-1.5">
            {returnContainerGroups.map(({ container, entries }) => (
              <Fragment key={container || "__ungrouped"}>
                {container ? (
                  <ScanContainerHeading label={container} />
                ) : returnContainerGroups.some((g) => g.container !== null) && (
                  <ScanContainerHeading label="No container" muted />
                )}
                {entries.map((entry) => {
                  if (entry.kind === "serialized-group") {
                    const childKeys = entry.items.map((i) => i.id);
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allChecked = childKeys.length > 0 && childKeys.every((k) => selectedIn.has(k));
                    const someChecked = childKeys.some((k) => selectedIn.has(k));
                    return (
                      <ScanGroupCard
                        key={entry.groupKey}
                        selectedState={allChecked ? true : someChecked ? "indeterminate" : false}
                        onToggleSelect={() => toggleGroupSelection(selectedIn, setSelectedIn, childKeys)}
                        expanded={isExpanded}
                        onToggleExpand={() => toggleExpanded(entry.groupKey)}
                        name={entry.modelName}
                        qtyLabel={entry.items.length}
                        status={<StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />}
                      >
                        {entry.items.map((item, idx) => (
                          <ScanItemCard
                            key={item.id}
                            indent
                            selected={selectedIn.has(item.id)}
                            onToggleSelect={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                            name={item.asset?.assetTag ? `${item.model?.name || "Asset"}` : `Unit ${idx + 1}`}
                            assetTag={item.asset?.assetTag || "—"}
                            qtyLabel={1}
                            status={<StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />}
                          />
                        ))}
                      </ScanGroupCard>
                    );
                  }

                  if (entry.kind === "bulk-group") {
                    const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allChecked = childKeys.length > 0 && childKeys.every((k) => selectedIn.has(k));
                    const someChecked = childKeys.some((k) => selectedIn.has(k));
                    const checkedCount = childKeys.filter((k) => selectedIn.has(k)).length;
                    const units = entry.item.units ?? [];
                    return (
                      <ScanGroupCard
                        key={entry.groupKey}
                        selectedState={allChecked ? true : someChecked ? "indeterminate" : false}
                        onToggleSelect={() => toggleGroupSelection(selectedIn, setSelectedIn, childKeys)}
                        expanded={isExpanded}
                        onToggleExpand={() => toggleExpanded(entry.groupKey)}
                        name={modelDisplayName(entry.item)}
                        assetTag={entry.item.bulkAsset?.assetTag || "—"}
                        qtyLabel={entry.unitCount}
                        status={checkedCount > 0 ? (
                          <Badge status="neutral" className="bg-blue-soft text-blue">{checkedCount} selected</Badge>
                        ) : (
                          <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />
                        )}
                      >
                        {childKeys.map((key, idx) => {
                          const unit = units[idx];
                          const tag = unit?.asset?.assetTag
                            ?? unit?.bulkAsset?.assetTag
                            ?? entry.item.bulkAsset?.assetTag
                            ?? "—";
                          return (
                            <ScanItemCard
                              key={key}
                              indent
                              selected={selectedIn.has(key)}
                              onToggleSelect={() => toggleSelection(selectedIn, setSelectedIn, key)}
                              name={`Unit ${idx + 1}`}
                              assetTag={tag}
                              qtyLabel={1}
                              status={null}
                            />
                          );
                        })}
                      </ScanGroupCard>
                    );
                  }

                  if (entry.kind === "kit-group") {
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allIds = collectAllVerifiableIds(entry.children, "return");
                    const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                    const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                    const allChildren = (entry.item.childLineItems || []) as LineItem[];
                    const isPartiallyDeployed = allChildren.some((c) => c.status !== "CHECKED_OUT" && c.status !== "CANCELLED");
                    return (
                      <ScanGroupCard
                        key={entry.groupKey}
                        selected={selectedIn.has(entry.item.id)}
                        onToggleSelect={() => toggleSelection(selectedIn, setSelectedIn, entry.item.id)}
                        expanded={isExpanded}
                        onToggleExpand={() => toggleExpanded(entry.groupKey)}
                        showKitGlyph
                        name={entry.item.description || entry.item.kit?.name || "Kit"}
                        badges={
                          <>
                            <Badge status="neutral">Kit</Badge>
                            {allIds.length > 0 && (
                              <Badge status={allVerified ? "ok" : verifiedCount > 0 ? "warn" : "neutral"} className="tabular-nums">
                                {verifiedCount}/{allIds.length} verified
                              </Badge>
                            )}
                          </>
                        }
                        assetTag={entry.item.kit?.assetTag || "—"}
                        qtyLabel={entry.children.length}
                        status={isPartiallyDeployed ? <Badge status="warn">Partial</Badge> : <StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />}
                      >
                        <MobileKitChildCards
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
                      </ScanGroupCard>
                    );
                  }

                  // Single item
                  const item = entry.item;
                  const isBulk = isBulkItem(item);
                  const assetTag = item.asset?.assetTag || item.bulkAsset?.assetTag || null;
                  return (
                    <ScanItemCard
                      key={item.id}
                      selected={selectedIn.has(item.id)}
                      onToggleSelect={() => toggleSelection(selectedIn, setSelectedIn, item.id)}
                      name={modelDisplayName(item)}
                      badges={
                        <>
                          {item.subHireId != null && (
                            <Badge status="neutral" className="bg-blue-soft text-blue">Subhire</Badge>
                          )}
                          {item.isCustomItem && <Badge status="neutral">Custom</Badge>}
                        </>
                      }
                      subtext={item.subHireId != null && item.supplier ? (
                        <p className="text-caption text-muted mt-0.5">via {item.supplier.name}</p>
                      ) : undefined}
                      assetTag={assetTag || "—"}
                      qtyLabel={isBulk ? (
                        <>
                          <span className={item.returnedQuantity > 0 ? "font-semibold text-ok" : ""}>{item.returnedQuantity}</span>
                          <span className="text-muted">/{item.checkedOutQuantity}</span>
                        </>
                      ) : 1}
                      status={<StatusIndicator category="lineItem" value="CHECKED_OUT" label="Deployed" variant="pill" />}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          </>
        )}
      </div>
    </TabsContent>
  );
}
