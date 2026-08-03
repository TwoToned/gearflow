"use client";

import { Fragment } from "react";
import {
  ChevronRight,
  Container,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
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
import { modelDisplayName, collectAllVerifiableIds, bulkUnitKey } from "./warehouse-types";
import { KitChildRows, MobileKitChildCards } from "./kit-child-rows";
import { PrepStatusBadge } from "./prep-status-badge";
import { ScanItemCard, ScanGroupCard } from "./scan-card";
import { SaleItemsToPrep } from "./sale-items-to-prep";
import type { SaleItemToPrep } from "@/lib/warehouse-detail-reconstruct";

type ContainerOption = { value: string; label: string; assetId?: string; assetTag?: string; modelId?: string };

export interface PickPrepTabProps {
  // Scan state
  scanInputRef: React.RefObject<HTMLInputElement | null>;
  scanValue: string;
  setScanValue: (v: string) => void;
  handleScanKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  scanMutationMutate: (value: string) => void;
  scanMutationIsPending: boolean;

  // Container state
  selectedContainer: string;
  setSelectedContainer: (v: string) => void;
  containerOptions: ContainerOption[];

  // Selection
  selectedPrep: Set<string>;
  setSelectedPrep: (s: Set<string>) => void;
  selectedPrepCount: number;
  allPrepKeys: string[];

  // Data
  pickPrepItems: LineItem[];
  groupedPrep: GroupEntry[];

  // NEW_STOCK sale items — SKU-picked, separate from the asset-tag/scan tree above.
  saleItemsToPrep: SaleItemToPrep[];
  onToggleSalePicked: (id: string, picked: boolean) => void;
  pendingSalePickIds: Set<string>;

  // Kit verification
  verifiedKitItems: Set<string>;
  setVerifiedKitItems: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Expand/collapse
  expandedGroups: Set<string>;
  toggleExpanded: (key: string) => void;

  // Actions
  handlePrepSelected: () => void;

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

export function PickPrepTab({
  scanInputRef,
  scanValue,
  setScanValue,
  handleScanKeyDown,
  scanMutationMutate,
  scanMutationIsPending,
  selectedContainer,
  setSelectedContainer,
  containerOptions,
  selectedPrep,
  setSelectedPrep,
  selectedPrepCount,
  allPrepKeys,
  pickPrepItems,
  groupedPrep,
  saleItemsToPrep,
  onToggleSalePicked,
  pendingSalePickIds,
  verifiedKitItems,
  setVerifiedKitItems,
  expandedGroups,
  toggleExpanded,
  handlePrepSelected,
  toggleSelection,
  toggleGroupSelection,
  toggleAll,
  renderGroupHeader,
}: PickPrepTabProps) {
  return (
    <TabsContent value="pick-prep">
      <div className="space-y-4 pt-4">
        <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] py-4 px-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <AssetTagInput
                  ref={scanInputRef}
                  placeholder="Scan or enter asset tag to prep..."
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={handleScanKeyDown}
                  onScan={(value) => scanMutationMutate(value)}
                  disabled={scanMutationIsPending}
                  className="h-11"
                  autoFocus
                />
              </div>
              <div className="w-48 shrink-0">
                <ComboboxPicker
                  value={selectedContainer}
                  onChange={setSelectedContainer}
                  options={containerOptions}
                  placeholder="No container"
                  searchPlaceholder="Search or create..."
                  creatable
                  allowClear
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-ui-text text-muted">
                Items that need to be picked and prepped.
                {selectedContainer && <span className="ml-1 text-ink-2 font-medium">&rarr; {selectedContainer}</span>}
              </p>
              <Button
                onClick={handlePrepSelected}
                disabled={selectedPrepCount === 0 || scanMutationIsPending}
                loading={scanMutationIsPending}
                className="shrink-0"
              >
                Prep{selectedPrepCount > 0 ? ` (${selectedPrepCount})` : ""}
              </Button>
            </div>
        </div>

        <SaleItemsToPrep
          items={saleItemsToPrep}
          onTogglePicked={onToggleSalePicked}
          pendingIds={pendingSalePickIds}
        />

        {pickPrepItems.length === 0 ? (
          <EmptyState
            title="All items prepped"
            description="Nice — everything's packed. Head to the Deploy tab to send it out."
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
                      checked={
                        allPrepKeys.length === 0
                          ? false
                          : allPrepKeys.every((k) => selectedPrep.has(k))
                            ? true
                            : allPrepKeys.some((k) => selectedPrep.has(k))
                              ? "indeterminate"
                              : false
                      }
                      onCheckedChange={() => toggleAll(selectedPrep, setSelectedPrep, allPrepKeys)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset tag</TableHead>
                  <TableHead className="text-center w-16">Qty</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedPrep.map((entry) => {
                  if (entry.kind === "serialized-group") {
                    const childKeys = entry.items.map((i) => i.id);
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedPrep, setSelectedPrep,
                          <TableCell>
                            {entry.items.every((i) => i.prepStatus === "PACKED")
                              ? <Badge status="ok">Prepped</Badge>
                              : entry.items.some((i) => i.prepStatus === "PACKED")
                                ? <Badge status="neutral" className="bg-blue-soft text-blue">Partial</Badge>
                                : <Badge status="warn">Needs prep</Badge>}
                          </TableCell>
                        )}
                        {isExpanded && entry.items.map((item, idx) => (
                          <Fragment key={item.id}>
                            <TableRow className="bg-paper-2/40">
                              <TableCell>
                                <Checkbox
                                  checked={selectedPrep.has(item.id)}
                                  onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, item.id)}
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
                                <PrepStatusBadge item={item} />
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        ))}
                      </Fragment>
                    );
                  }

                  if (entry.kind === "bulk-group") {
                    const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const checkedCount = childKeys.filter((k) => selectedPrep.has(k)).length;
                    // Per-unit assignments — show the actual asset tag
                    // chosen during prep, not the line-level bulk tag
                    // (which is null for multi-quantity serialised lines).
                    const units = entry.item.units ?? [];
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedPrep, setSelectedPrep,
                          <TableCell>
                            {checkedCount > 0 ? (
                              <Badge status="neutral" className="bg-blue-soft text-blue">
                                {checkedCount} selected
                              </Badge>
                            ) : (
                              <PrepStatusBadge item={entry.item} />
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
                                  checked={selectedPrep.has(key)}
                                  onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, key)}
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

                  if (entry.kind === "kit-group") {
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allIds = collectAllVerifiableIds(entry.children, "deploy");
                    const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                    const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
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
                              checked={selectedPrep.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, entry.item.id)}
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
                            <PrepStatusBadge item={entry.item} />
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <KitChildRows
                            kitChildren={entry.children}
                            mode="deploy"
                            verifiedKitItems={verifiedKitItems}
                            expandedGroups={expandedGroups}
                            toggleExpanded={toggleExpanded}
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

                  if (entry.kind === "accessory-group") {
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allIds = collectAllVerifiableIds(entry.children, "deploy");
                    const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                    const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
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
                              checked={selectedPrep.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, entry.item.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <ChevronRight className={`h-4 w-4 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                              <span className="font-medium text-ink">{modelDisplayName(entry.item)}</span>
                              <Badge status="neutral" className="ml-1">
                                Accessories
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
                            {entry.item.asset?.assetTag || entry.item.bulkAsset?.assetTag || "—"}
                          </TableCell>
                          <TableCell className="text-center tabular-nums">{entry.item.quantity}</TableCell>
                          <TableCell>
                            <PrepStatusBadge item={entry.item} />
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <KitChildRows
                            kitChildren={entry.children}
                            mode="deploy"
                            verifiedKitItems={verifiedKitItems}
                            expandedGroups={expandedGroups}
                            toggleExpanded={toggleExpanded}
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

                  // Single item
                  const item = entry.item;
                  return (
                    <Fragment key={item.id}>
                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={selectedPrep.has(item.id)}
                          onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, item.id)}
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
                        {item.asset?.assetTag || item.bulkAsset?.assetTag || "—"}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
                      <TableCell>
                        <PrepStatusBadge item={item} />
                      </TableCell>
                    </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: card list (§15) — same grouped data + handlers */}
          <div className="md:hidden space-y-1.5">
            {groupedPrep.map((entry) => {
              if (entry.kind === "serialized-group") {
                const childKeys = entry.items.map((i) => i.id);
                const isExpanded = expandedGroups.has(entry.groupKey);
                const allChecked = childKeys.length > 0 && childKeys.every((k) => selectedPrep.has(k));
                const someChecked = childKeys.some((k) => selectedPrep.has(k));
                return (
                  <ScanGroupCard
                    key={entry.groupKey}
                    selectedState={allChecked ? true : someChecked ? "indeterminate" : false}
                    onToggleSelect={() => toggleGroupSelection(selectedPrep, setSelectedPrep, childKeys)}
                    expanded={isExpanded}
                    onToggleExpand={() => toggleExpanded(entry.groupKey)}
                    name={entry.modelName}
                    qtyLabel={entry.items.length}
                    status={
                      entry.items.every((i) => i.prepStatus === "PACKED")
                        ? <Badge status="ok">Prepped</Badge>
                        : entry.items.some((i) => i.prepStatus === "PACKED")
                          ? <Badge status="neutral" className="bg-blue-soft text-blue">Partial</Badge>
                          : <Badge status="warn">Needs prep</Badge>
                    }
                  >
                    {entry.items.map((item, idx) => (
                      <ScanItemCard
                        key={item.id}
                        indent
                        selected={selectedPrep.has(item.id)}
                        onToggleSelect={() => toggleSelection(selectedPrep, setSelectedPrep, item.id)}
                        name={item.asset?.assetTag ? `${item.model?.name || "Asset"}` : `Unit ${idx + 1}`}
                        assetTag={item.asset?.assetTag || "—"}
                        qtyLabel={1}
                        status={<PrepStatusBadge item={item} />}
                      />
                    ))}
                  </ScanGroupCard>
                );
              }

              if (entry.kind === "bulk-group") {
                const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                const isExpanded = expandedGroups.has(entry.groupKey);
                const allChecked = childKeys.length > 0 && childKeys.every((k) => selectedPrep.has(k));
                const someChecked = childKeys.some((k) => selectedPrep.has(k));
                const checkedCount = childKeys.filter((k) => selectedPrep.has(k)).length;
                const units = entry.item.units ?? [];
                return (
                  <ScanGroupCard
                    key={entry.groupKey}
                    selectedState={allChecked ? true : someChecked ? "indeterminate" : false}
                    onToggleSelect={() => toggleGroupSelection(selectedPrep, setSelectedPrep, childKeys)}
                    expanded={isExpanded}
                    onToggleExpand={() => toggleExpanded(entry.groupKey)}
                    name={modelDisplayName(entry.item)}
                    assetTag={entry.item.bulkAsset?.assetTag || "—"}
                    qtyLabel={entry.unitCount}
                    status={checkedCount > 0 ? (
                      <Badge status="neutral" className="bg-blue-soft text-blue">{checkedCount} selected</Badge>
                    ) : (
                      <PrepStatusBadge item={entry.item} />
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
                          selected={selectedPrep.has(key)}
                          onToggleSelect={() => toggleSelection(selectedPrep, setSelectedPrep, key)}
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
                const allIds = collectAllVerifiableIds(entry.children, "deploy");
                const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                return (
                  <ScanGroupCard
                    key={entry.groupKey}
                    selected={selectedPrep.has(entry.item.id)}
                    onToggleSelect={() => toggleSelection(selectedPrep, setSelectedPrep, entry.item.id)}
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
                    status={<PrepStatusBadge item={entry.item} />}
                  >
                    <MobileKitChildCards
                      kitChildren={entry.children}
                      verifiedKitItems={verifiedKitItems}
                      expandedGroups={expandedGroups}
                      toggleExpanded={toggleExpanded}
                      mode="deploy"
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

              if (entry.kind === "accessory-group") {
                const isExpanded = expandedGroups.has(entry.groupKey);
                const allIds = collectAllVerifiableIds(entry.children, "deploy");
                const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                return (
                  <ScanGroupCard
                    key={entry.groupKey}
                    selected={selectedPrep.has(entry.item.id)}
                    onToggleSelect={() => toggleSelection(selectedPrep, setSelectedPrep, entry.item.id)}
                    expanded={isExpanded}
                    onToggleExpand={() => toggleExpanded(entry.groupKey)}
                    name={modelDisplayName(entry.item)}
                    badges={
                      <>
                        <Badge status="neutral">Accessories</Badge>
                        {allIds.length > 0 && (
                          <Badge status={allVerified ? "ok" : verifiedCount > 0 ? "warn" : "neutral"} className="tabular-nums">
                            {verifiedCount}/{allIds.length} verified
                          </Badge>
                        )}
                      </>
                    }
                    assetTag={entry.item.asset?.assetTag || entry.item.bulkAsset?.assetTag || "—"}
                    qtyLabel={entry.children.length}
                    status={<PrepStatusBadge item={entry.item} />}
                  >
                    <MobileKitChildCards
                      kitChildren={entry.children}
                      verifiedKitItems={verifiedKitItems}
                      expandedGroups={expandedGroups}
                      toggleExpanded={toggleExpanded}
                      mode="deploy"
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
              return (
                <ScanItemCard
                  key={item.id}
                  selected={selectedPrep.has(item.id)}
                  onToggleSelect={() => toggleSelection(selectedPrep, setSelectedPrep, item.id)}
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
                  assetTag={item.asset?.assetTag || item.bulkAsset?.assetTag || "—"}
                  qtyLabel={item.quantity}
                  status={<PrepStatusBadge item={item} />}
                />
              );
            })}
          </div>
          </>
        )}
      </div>
    </TabsContent>
  );
}
