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
import { AccessoryChildRows } from "./accessory-child-rows";
import { PrepStatusBadge } from "./prep-status-badge";

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
        <div className="rounded-lg bg-bg-surface surface-ring py-4 px-4 space-y-3">
            <AssetTagInput
              ref={deployScanInputRef}
              placeholder="Scan asset tag to deploy..."
              value={deployScanValue}
              onChange={(e) => setDeployScanValue(e.target.value)}
              onScan={(value) => deployScanMutationMutate(value)}
              onKeyDown={handleDeployScanKeyDown}
              disabled={deployScanMutationIsPending || checkOutIsPending}
            />
            <div className="flex items-center justify-between">
              <p className="text-sm text-fg-3">Items prepped and ready to deploy.</p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm text-fg-3 cursor-pointer">
                  <Checkbox
                    checked={includeAccessories}
                    onCheckedChange={(c) => onIncludeAccessoriesChange(c === true)}
                  />
                  Include accessories
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeprep(selectedOut)}
                  disabled={selectedOutCount === 0 || deprepIsPending}
                >
                  Deprep{selectedOutCount > 0 ? ` (${selectedOutCount})` : ""}
                </Button>
                <Button
                  onClick={handleCheckOutSelected}
                  disabled={selectedOutCount === 0 || checkOutIsPending}
                  className="shrink-0"
                >
                  Deploy{selectedOutCount > 0 ? ` (${selectedOutCount})` : ""}
                </Button>
              </div>
            </div>
        </div>

        {checkOutItemsList.length === 0 ? (
          <div className="rounded-lg bg-bg-surface surface-ring py-8 text-center text-fg-3">
              <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No prepped items ready to deploy.</p>
              <p className="text-xs mt-1">Pick and prep items first in the Pick/Prep tab.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allOutKeys.length > 0 && (allOutKeys.every((k) => selectedOut.has(k)) || allOutKeys.some((k) => selectedOut.has(k)))}
                      indeterminate={allOutKeys.length > 0 && allOutKeys.some((k) => selectedOut.has(k)) && !allOutKeys.every((k) => selectedOut.has(k))}
                      onCheckedChange={() => toggleAll(selectedOut, setSelectedOut, allOutKeys)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead className="text-center w-16">Qty</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployContainerGroups.map(({ container, entries }) => (
                  <Fragment key={container || "__ungrouped"}>
                    {container ? (
                      <TableRow className="bg-bg-inset/50">
                        <TableCell colSpan={5} className="py-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-fg-2 uppercase tracking-wide">
                              <Package className="h-3.5 w-3.5" />
                              {container}
                            </div>
                            <button
                              type="button"
                              onClick={() => clearContainerMutate(container)}
                              disabled={clearContainerIsPending}
                              className="rounded p-0.5 text-fg-3 hover:text-fg-1 hover:bg-bg-hover transition-colors"
                              title="Remove container"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : deployContainerGroups.some((g) => g.container !== null) && (
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
                          entry, childKeys, selectedOut, setSelectedOut,
                          <TableCell>
                            <PrepStatusBadge item={entry.items[0]} />
                          </TableCell>
                        )}
                        {isExpanded && entry.items.map((item, idx) => (
                          <Fragment key={item.id}>
                            <TableRow className="bg-bg-inset/30">
                              <TableCell>
                                <Checkbox
                                  checked={selectedOut.has(item.id)}
                                  onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, item.id)}
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
                                <PrepStatusBadge item={item} />
                              </TableCell>
                            </TableRow>
                            <AccessoryChildRows parent={item} mode="deploy" />
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
                              <Badge variant="outline" className="bg-teal-500/10 text-teal-500 border-teal-500/20">
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
                            <TableRow key={key} className="bg-bg-inset/30">
                              <TableCell>
                                <Checkbox
                                  checked={selectedOut.has(key)}
                                  onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, key)}
                                />
                              </TableCell>
                              <TableCell className="pl-12 text-sm text-fg-3">
                                Unit {idx + 1}
                              </TableCell>
                              <TableCell className="font-mono text-sm text-fg-3">
                                {tag}
                              </TableCell>
                              <TableCell className="text-center">1</TableCell>
                              <TableCell />
                            </TableRow>
                          );
                        })}
                        {/* Accessories on a multi-qty serialised model line (classified
                            bulk-group) still travel with the parent. Gated on
                            isExpanded so they hide with the group's unit rows. */}
                        {isExpanded && <AccessoryChildRows parent={entry.item} mode="deploy" />}
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
                          className="cursor-pointer hover:bg-accent/50"
                          onClick={() => toggleExpanded(entry.groupKey)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedOut.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedOut, setSelectedOut, entry.item.id)}
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
                        {item.asset?.assetTag || item.bulkAsset?.assetTag || "—"}
                      </TableCell>
                      <TableCell className="text-center">{item.quantity}</TableCell>
                      <TableCell>
                        <PrepStatusBadge item={item} />
                      </TableCell>
                    </TableRow>
                    <AccessoryChildRows parent={item} mode="deploy" />
                    </Fragment>
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
