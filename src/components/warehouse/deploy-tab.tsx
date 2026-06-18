"use client";

import { Fragment } from "react";
import {
  ChevronRight,
  Package,
  Container,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AssetTagInput } from "@/components/ui/asset-tag-input";
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
import { modelDisplayName, collectAllVerifiableIds, bulkUnitKey } from "./warehouse-types";
import { KitChildRows } from "./kit-child-rows";
import { MobileKitChildCards } from "./kit-child-rows";
import { PrepStatusBadge } from "./prep-status-badge";
import { ScanItemCard, ScanGroupCard, ScanContainerHeading } from "./scan-card";

export interface DeployTabProps {
  // Scan state
  deployScanInputRef: React.RefObject<HTMLInputElement | null>;
  deployScanValue: string;
  setDeployScanValue: (v: string) => void;
  handleDeployScanKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  deployScanMutationMutate: (value: string) => void;
  deployScanMutationIsPending: boolean;

  // Selection
  selectedOut: Set<string>;
  setSelectedOut: (s: Set<string>) => void;
  selectedOutCount: number;
  allOutKeys: string[];

  // Data
  checkOutItemsList: LineItem[];
  deployContainerGroups: Array<{ container: string | null; entries: GroupEntry[] }>;

  // Kit verification
  verifiedKitItems: Set<string>;
  setVerifiedKitItems: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Expand/collapse
  expandedGroups: Set<string>;
  toggleExpanded: (key: string) => void;

  // Actions
  handleCheckOutSelected: () => void;
  handleDeprep: (ids: Set<string>) => void;
  deprepIsPending: boolean;
  clearContainerMutate: (containerName: string) => void;
  clearContainerIsPending: boolean;
  checkOutIsPending: boolean;

  // Accessories
  includeAccessories: boolean;
  onIncludeAccessoriesChange: (v: boolean) => void;

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

export function DeployTab({
  deployScanInputRef,
  deployScanValue,
  setDeployScanValue,
  handleDeployScanKeyDown,
  deployScanMutationMutate,
  deployScanMutationIsPending,
  selectedOut,
  setSelectedOut,
  selectedOutCount,
  allOutKeys,
  checkOutItemsList,
  deployContainerGroups,
  verifiedKitItems,
  setVerifiedKitItems,
  expandedGroups,
  toggleExpanded,
  handleCheckOutSelected,
  handleDeprep,
  deprepIsPending,
  clearContainerMutate,
  clearContainerIsPending,
  checkOutIsPending,
  toggleSelection,
  toggleGroupSelection,
  toggleAll,
  renderGroupHeader,
  includeAccessories,
  onIncludeAccessoriesChange,
}: DeployTabProps) {
  return (
    <TabsContent value="check-out">
      <div className="space-y-4 pt-4">
        <div className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] py-4 px-4 space-y-3">
            <AssetTagInput
              ref={deployScanInputRef}
              placeholder="Scan asset tag to deploy..."
              value={deployScanValue}
              onChange={(e) => setDeployScanValue(e.target.value)}
              onScan={(value) => deployScanMutationMutate(value)}
              onKeyDown={handleDeployScanKeyDown}
              disabled={deployScanMutationIsPending || checkOutIsPending}
              className="h-11"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-ui-text text-muted">Items prepped and ready to deploy.</p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-ui-text text-muted cursor-pointer">
                  <Checkbox
                    checked={includeAccessories}
                    onCheckedChange={(c) => onIncludeAccessoriesChange(c === true)}
                  />
                  Include accessories
                </label>
                <Button
                  variant="line"
                  size="sm"
                  onClick={() => handleDeprep(selectedOut)}
                  disabled={selectedOutCount === 0 || deprepIsPending}
                  loading={deprepIsPending}
                >
                  Deprep{selectedOutCount > 0 ? ` (${selectedOutCount})` : ""}
                </Button>
                <Button
                  onClick={handleCheckOutSelected}
                  disabled={selectedOutCount === 0 || checkOutIsPending}
                  loading={checkOutIsPending}
                  className="shrink-0"
                >
                  Deploy{selectedOutCount > 0 ? ` (${selectedOutCount})` : ""}
                </Button>
              </div>
            </div>
        </div>

        {checkOutItemsList.length === 0 ? (
          <EmptyState
            title="Nothing to deploy yet"
            description="Pick and prep items in the Pick/Prep tab, then deploy them here."
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
                        allOutKeys.length === 0
                          ? false
                          : allOutKeys.every((k) => selectedOut.has(k))
                            ? true
                            : allOutKeys.some((k) => selectedOut.has(k))
                              ? "indeterminate"
                              : false
                      }
                      onCheckedChange={() => toggleAll(selectedOut, setSelectedOut, allOutKeys)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset tag</TableHead>
                  <TableHead className="text-center w-16">Qty</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployContainerGroups.map(({ container, entries }) => (
                  <Fragment key={container || "__ungrouped"}>
                    {container ? (
                      <TableRow className="bg-paper-2/60">
                        <TableCell colSpan={5} className="py-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-caption font-semibold text-ink-2">
                              <Package className="h-3.5 w-3.5" />
                              {container}
                            </div>
                            <button
                              type="button"
                              onClick={() => clearContainerMutate(container)}
                              disabled={clearContainerIsPending}
                              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r)] text-muted transition-colors hover:text-t-out hover:bg-out-soft disabled:opacity-45 disabled:cursor-not-allowed ${focusRing}`}
                              title="Remove container"
                              aria-label={`Remove container ${container}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : deployContainerGroups.some((g) => g.container !== null) && (
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
                          entry, childKeys, selectedOut, setSelectedOut,
                          <TableCell>
                            <PrepStatusBadge item={entry.items[0]} />
                          </TableCell>
                        )}
                        {isExpanded && entry.items.map((item, idx) => (
                          <Fragment key={item.id}>
                            <TableRow className="bg-paper-2/40">
                              <TableCell>
                                <Checkbox
                                  checked={selectedOut.has(item.id)}
                                  onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
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

                  // --- Bulk group ---
                  if (entry.kind === "bulk-group") {
                    const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const checkedCount = childKeys.filter((k) => selectedOut.has(k)).length;
                    // Per-unit assignments from prep (post-cutover source of
                    // truth). Indexed in display order so the Nth synthetic
                    // row shows the Nth unit's actual asset tag.
                    const units = entry.item.units ?? [];
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedOut, setSelectedOut,
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
                                  checked={selectedOut.has(key)}
                                  onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, key)}
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
                    const allIds = collectAllVerifiableIds(entry.children, "deploy");
                    const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                    const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                    // Detect partial deployment: parent is checked out but some children still need deploying
                    const allChildren = (entry.item.childLineItems || []) as LineItem[];
                    const isPartiallyDeployed = entry.item.status === "CHECKED_OUT" && allChildren.some((c) => c.status === "CHECKED_OUT");
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
                              checked={selectedOut.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, entry.item.id)}
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
                              <PrepStatusBadge item={entry.item} />
                            )}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <KitChildRows
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
                        )}
                      </Fragment>
                    );
                  }

                  // --- Single item ---
                  const item = entry.item;
                  return (
                    <Fragment key={item.id}>
                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={selectedOut.has(item.id)}
                          onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
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
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: card list (§15) — same grouped data + handlers */}
          <div className="md:hidden space-y-1.5">
            {deployContainerGroups.map(({ container, entries }) => (
              <Fragment key={container || "__ungrouped"}>
                {container ? (
                  <ScanContainerHeading
                    label={container}
                    action={
                      <button
                        type="button"
                        onClick={() => clearContainerMutate(container)}
                        disabled={clearContainerIsPending}
                        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r)] text-muted transition-colors hover:text-t-out hover:bg-out-soft disabled:opacity-45 disabled:cursor-not-allowed ${focusRing}`}
                        title="Remove container"
                        aria-label={`Remove container ${container}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    }
                  />
                ) : deployContainerGroups.some((g) => g.container !== null) && (
                  <ScanContainerHeading label="No container" muted />
                )}
                {entries.map((entry) => {
                  if (entry.kind === "serialized-group") {
                    const childKeys = entry.items.map((i) => i.id);
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allChecked = childKeys.length > 0 && childKeys.every((k) => selectedOut.has(k));
                    const someChecked = childKeys.some((k) => selectedOut.has(k));
                    return (
                      <ScanGroupCard
                        key={entry.groupKey}
                        selectedState={allChecked ? true : someChecked ? "indeterminate" : false}
                        onToggleSelect={() => toggleGroupSelection(selectedOut, setSelectedOut, childKeys)}
                        expanded={isExpanded}
                        onToggleExpand={() => toggleExpanded(entry.groupKey)}
                        name={entry.modelName}
                        qtyLabel={entry.items.length}
                        status={<PrepStatusBadge item={entry.items[0]} />}
                      >
                        {entry.items.map((item, idx) => (
                          <ScanItemCard
                            key={item.id}
                            indent
                            selected={selectedOut.has(item.id)}
                            onToggleSelect={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
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
                    const allChecked = childKeys.length > 0 && childKeys.every((k) => selectedOut.has(k));
                    const someChecked = childKeys.some((k) => selectedOut.has(k));
                    const checkedCount = childKeys.filter((k) => selectedOut.has(k)).length;
                    const units = entry.item.units ?? [];
                    return (
                      <ScanGroupCard
                        key={entry.groupKey}
                        selectedState={allChecked ? true : someChecked ? "indeterminate" : false}
                        onToggleSelect={() => toggleGroupSelection(selectedOut, setSelectedOut, childKeys)}
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
                              selected={selectedOut.has(key)}
                              onToggleSelect={() => toggleSelection(selectedOut, setSelectedOut, key)}
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
                    const allChildren = (entry.item.childLineItems || []) as LineItem[];
                    const isPartiallyDeployed = entry.item.status === "CHECKED_OUT" && allChildren.some((c) => c.status === "CHECKED_OUT");
                    return (
                      <ScanGroupCard
                        key={entry.groupKey}
                        selected={selectedOut.has(entry.item.id)}
                        onToggleSelect={() => toggleSelection(selectedOut, setSelectedOut, entry.item.id)}
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
                        status={isPartiallyDeployed ? <Badge status="warn">Partial</Badge> : <PrepStatusBadge item={entry.item} />}
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
                      selected={selectedOut.has(item.id)}
                      onToggleSelect={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
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
              </Fragment>
            ))}
          </div>
          </>
        )}
      </div>
    </TabsContent>
  );
}
