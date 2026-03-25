"use client";

import { Fragment } from "react";
import {
  ScanBarcode,
  ChevronRight,
  PackageCheck,
  Container,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScanInput } from "@/components/ui/scan-input";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
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
import { PrepStatusBadge } from "./prep-status-badge";

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
        <div className="rounded-lg bg-bg-surface surface-ring py-4 px-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ScanInput
                  ref={scanInputRef}
                  placeholder="Scan or enter asset tag to prep..."
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={handleScanKeyDown}
                  onScan={(value) => scanMutationMutate(value)}
                  scannerTitle="Scan asset to prep"
                  continuous
                  disabled={scanMutationIsPending}
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
            <div className="flex items-center justify-between">
              <p className="text-sm text-fg-3">
                Items that need to be picked and prepped.
                {selectedContainer && <span className="ml-1 text-fg-2 font-medium">&rarr; {selectedContainer}</span>}
              </p>
              <Button
                onClick={handlePrepSelected}
                disabled={selectedPrepCount === 0 || scanMutationIsPending}
                className="shrink-0"
              >
                Prep{selectedPrepCount > 0 ? ` (${selectedPrepCount})` : ""}
              </Button>
            </div>
        </div>

        {pickPrepItems.length === 0 ? (
          <div className="rounded-lg bg-bg-surface surface-ring py-8 text-center text-fg-3">
              <PackageCheck className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>All items prepped.</p>
              <p className="text-xs mt-1">Head to the Deploy tab to send them out.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allPrepKeys.length > 0 && (allPrepKeys.every((k) => selectedPrep.has(k)) || allPrepKeys.some((k) => selectedPrep.has(k)))}
                      indeterminate={allPrepKeys.length > 0 && allPrepKeys.some((k) => selectedPrep.has(k)) && !allPrepKeys.every((k) => selectedPrep.has(k))}
                      onCheckedChange={() => toggleAll(selectedPrep, setSelectedPrep, allPrepKeys)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset Tag</TableHead>
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
                              ? <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Prepped</Badge>
                              : entry.items.some((i) => i.prepStatus === "PACKED")
                                ? <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Partial</Badge>
                                : <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">Needs prep</Badge>}
                          </TableCell>
                        )}
                        {isExpanded && entry.items.map((item, idx) => (
                          <TableRow key={item.id} className="bg-bg-inset/30">
                            <TableCell>
                              <Checkbox
                                checked={selectedPrep.has(item.id)}
                                onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, item.id)}
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
                        ))}
                      </Fragment>
                    );
                  }

                  if (entry.kind === "bulk-group") {
                    const childKeys = Array.from({ length: entry.unitCount }, (_, i) => bulkUnitKey(entry.item.id, i));
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const checkedCount = childKeys.filter((k) => selectedPrep.has(k)).length;
                    return (
                      <Fragment key={entry.groupKey}>
                        {renderGroupHeader(
                          entry, childKeys, selectedPrep, setSelectedPrep,
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
                        {isExpanded && childKeys.map((key, idx) => (
                          <TableRow key={key} className="bg-bg-inset/30">
                            <TableCell>
                              <Checkbox
                                checked={selectedPrep.has(key)}
                                onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, key)}
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

                  if (entry.kind === "kit-group") {
                    const isExpanded = expandedGroups.has(entry.groupKey);
                    const allIds = collectAllVerifiableIds(entry.children, "deploy");
                    const verifiedCount = allIds.filter((id) => verifiedKitItems.has(id)).length;
                    const allVerified = allIds.length > 0 && verifiedCount === allIds.length;
                    return (
                      <Fragment key={entry.groupKey}>
                        <TableRow
                          className="cursor-pointer hover:bg-accent/50"
                          onClick={() => toggleExpanded(entry.groupKey)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedPrep.has(entry.item.id)}
                              onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, entry.item.id)}
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
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedPrep.has(item.id)}
                          onCheckedChange={() => toggleSelection(selectedPrep, setSelectedPrep, item.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{modelDisplayName(item)}</span>
                        {item.isSubhire && (
                          <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-600 border-cyan-500/20">Subhire</Badge>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </TabsContent>
  );
}
