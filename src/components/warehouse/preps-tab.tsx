"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  PackageCheck,
  PackagePlus,
  PackageX,
  PackageOpen,
  Trash2,
  X,
  ChevronRight,
  Container,
  Plus,
  Minus,
} from "lucide-react";
import { toast } from "sonner";

import {
  getProjectPrepKits,
  createPrepKit,
  addItemToPrepKitByTag,
  addItemToPrepKit,
  searchPrepKitItems,
  searchCaseAssets,
  addToPrepKitAndProject,
  removeItemFromPrepKit,
  dissolvePrepKit,
} from "@/server/kits";
import { getOrganization, type OrgSettings } from "@/server/settings";
import { checkOutKit, checkInKit } from "@/server/warehouse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useActiveOrganization } from "@/lib/auth-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChildLineItem {
  id: string;
  type: string;
  status: string;
  quantity: number;
  description: string | null;
  modelId: string | null;
  assetId: string | null;
  bulkAssetId: string | null;
  kitId: string | null;
  isKitChild: boolean;
  parentLineItemId: string | null;
  model: { name: string; modelNumber?: string | null } | null;
  asset: { assetTag: string } | null;
  bulkAsset: { assetTag: string } | null;
  kit?: { id: string; assetTag: string; name: string; isPrep: boolean } | null;
  childLineItems?: ChildLineItem[];
}

interface PrepKitLineItem {
  id: string;
  projectId: string;
  childLineItems: ChildLineItem[];
}

interface PrepKit {
  id: string;
  name: string;
  assetTag: string;
  status: string;
  isPrep: boolean;
  isActive: boolean;
  lineItems: PrepKitLineItem[];
}

const kitStatusColors: Record<string, string> = {
  AVAILABLE: "bg-green-500/10 text-green-500 border-green-500/20",
  CHECKED_OUT: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  IN_MAINTENANCE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  RETIRED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const kitStatusLabels: Record<string, string> = {
  AVAILABLE: "Ready",
  CHECKED_OUT: "Deployed",
  IN_MAINTENANCE: "Maintenance",
  RETIRED: "Dissolved",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PrepsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailKitId, setDetailKitId] = useState<string | null>(null);
  const [newPrepName, setNewPrepName] = useState("");
  const [selectedCaseAsset, setSelectedCaseAsset] = useState<{ id: string; assetTag: string; modelName: string } | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [showCaseResults, setShowCaseResults] = useState(false);
  const caseSearchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [debouncedCaseQuery, setDebouncedCaseQuery] = useState("");

  const { data: org } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: getOrganization,
  });
  const orgSettings = (org as Record<string, unknown> | undefined)?.settings as OrgSettings | undefined;
  const hasCaseCategory = !!orgSettings?.prepKitCategoryId;

  const { data: prepKits, isLoading } = useQuery({
    queryKey: ["project-prep-kits", orgId, projectId],
    queryFn: () => getProjectPrepKits(projectId),
  });

  // Debounced case search
  useEffect(() => {
    if (caseSearchTimerRef.current) clearTimeout(caseSearchTimerRef.current);
    if (caseSearch.trim().length >= 2) {
      caseSearchTimerRef.current = setTimeout(() => {
        setDebouncedCaseQuery(caseSearch.trim());
        setShowCaseResults(true);
      }, 300);
    } else {
      setDebouncedCaseQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
      setShowCaseResults(false); // eslint-disable-line react-hooks/set-state-in-effect
    }
    return () => { if (caseSearchTimerRef.current) clearTimeout(caseSearchTimerRef.current); };
  }, [caseSearch]);

  const caseSearchQuery = useQuery({
    queryKey: ["case-assets-search", debouncedCaseQuery],
    queryFn: () => searchCaseAssets(debouncedCaseQuery),
    enabled: debouncedCaseQuery.length >= 2,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project-prep-kits", orgId, projectId] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-project", orgId, projectId] });
  }, [queryClient, orgId, projectId]);

  const createMutation = useMutation({
    mutationFn: () => createPrepKit(projectId, newPrepName || selectedCaseAsset?.modelName || "Prep-Kit", selectedCaseAsset?.id),
    onSuccess: (kit) => {
      toast.success(`Created prep-kit "${kit.name}"`);
      setCreateOpen(false);
      setNewPrepName("");
      setSelectedCaseAsset(null);
      setCaseSearch("");
      invalidate();
      setDetailKitId(kit.id);
    },
    onError: (err) => toast.error(err.message),
  });

  const dissolveMutation = useMutation({
    mutationFn: (kitId: string) => dissolvePrepKit(kitId),
    onSuccess: () => { toast.success("Prep-kit dissolved"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const deployMutation = useMutation({
    mutationFn: (kitId: string) => checkOutKit(projectId, kitId),
    onSuccess: () => { toast.success("Prep-kit deployed"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const returnMutation = useMutation({
    mutationFn: (kitId: string) => checkInKit(projectId, kitId, "GOOD"),
    onSuccess: () => { toast.success("Prep-kit returned"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const detailKit = (prepKits as PrepKit[] | undefined)?.find((k) => k.id === detailKitId);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-center">Loading prep-kits...</div>;
  }

  return (
    <div className="space-y-4 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {(prepKits as PrepKit[] | undefined)?.length ?? 0} prep-kit{((prepKits as PrepKit[] | undefined)?.length ?? 0) !== 1 ? "s" : ""} for this project
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PackagePlus className="mr-1.5 h-4 w-4" />
          New Prep-Kit
        </Button>
      </div>

      {/* Prep-kit cards */}
      {prepKits && (prepKits as PrepKit[]).length > 0 ? (
        <div className="grid gap-3">
          {(prepKits as PrepKit[]).map((kit) => {
            const parentLI = kit.lineItems[0];
            const childCount = parentLI?.childLineItems?.length ?? 0;
            return (
              <Card key={kit.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setDetailKitId(kit.id)}>
                <CardContent className="py-3 flex items-center gap-3">
                  <div className="shrink-0">
                    {kit.status === "AVAILABLE" && <PackageCheck className="h-5 w-5 text-green-500" />}
                    {kit.status === "CHECKED_OUT" && <PackageX className="h-5 w-5 text-purple-500" />}
                    {kit.status !== "AVAILABLE" && kit.status !== "CHECKED_OUT" && <Package className="h-5 w-5 text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{kit.name}</span>
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      {!kit.assetTag.startsWith("PREP-") && (
                        <span className="font-mono text-xs">{kit.assetTag}</span>
                      )}
                      <span>{childCount} item{childCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className={kitStatusColors[kit.status] || ""}>
                    {kitStatusLabels[kit.status] || kit.status}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No prep-kits yet. Create one to group project items for deployment.</p>
          </CardContent>
        </Card>
      )}

      {/* Create Prep-Kit Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) { setSelectedCaseAsset(null); setCaseSearch(""); setNewPrepName(""); }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Prep-Kit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Case asset search (if org has case category configured) */}
            {hasCaseCategory && !selectedCaseAsset && (
              <div className="relative">
                <Label className="text-xs text-muted-foreground">Scan or search for a case</Label>
                <ScanInput
                  placeholder="Search cases by name or tag..."
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowCaseResults(false);
                  }}
                  onFocus={() => { if (debouncedCaseQuery.length >= 2) setShowCaseResults(true); }}
                  onBlur={() => setTimeout(() => setShowCaseResults(false), 200)}
                  onScan={(value) => setCaseSearch(value)}
                  scannerTitle="Scan case asset"
                  autoFocus
                />
                {showCaseResults && caseSearchQuery.data && (caseSearchQuery.data as unknown[]).length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                    {(caseSearchQuery.data as Array<{
                      id: string;
                      assetTag: string;
                      modelName: string;
                      modelNumber: string | null;
                      customName: string | null;
                      status: string;
                    }>).map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedCaseAsset({ id: asset.id, assetTag: asset.assetTag, modelName: asset.modelName });
                          setCaseSearch("");
                          setShowCaseResults(false);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{asset.customName || asset.modelName}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span className="font-mono">{asset.assetTag}</span>
                            {asset.modelNumber && <span>{asset.modelNumber}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Selected case asset */}
            {selectedCaseAsset && (
              <div className="flex items-center gap-2 p-2 bg-accent/50 rounded-md">
                <Container className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{selectedCaseAsset.modelName}</div>
                  <div className="font-mono text-xs text-muted-foreground">{selectedCaseAsset.assetTag}</div>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedCaseAsset(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Custom name (always shown, used as fallback or override) */}
            {!selectedCaseAsset && (
              <div>
                <Label htmlFor="prep-kit-name">{hasCaseCategory ? "Or enter a custom name" : "Name"}</Label>
                <Input
                  id="prep-kit-name"
                  placeholder="e.g. FOH Rack, Mic Case A..."
                  value={newPrepName}
                  onChange={(e) => setNewPrepName(e.target.value)}
                  autoFocus={!hasCaseCategory}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPrepName.trim()) {
                      e.preventDefault();
                      createMutation.mutate();
                    }
                  }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={(!newPrepName.trim() && !selectedCaseAsset) || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prep-Kit Detail Dialog */}
      {detailKit && (
        <PrepKitDetailDialog
          kit={detailKit}
          projectId={projectId}
          onClose={() => setDetailKitId(null)}
          onDeploy={(id) => deployMutation.mutate(id)}
          onReturn={(id) => returnMutation.mutate(id)}
          onDissolve={(id) => { dissolveMutation.mutate(id); setDetailKitId(null); }}
          invalidate={invalidate}
          isPending={deployMutation.isPending || returnMutation.isPending || dissolveMutation.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prep-Kit Detail Dialog
// ---------------------------------------------------------------------------

function PrepKitDetailDialog({
  kit,
  projectId,
  onClose,
  onDeploy,
  onReturn,
  onDissolve,
  invalidate,
  isPending,
}: {
  kit: PrepKit;
  projectId: string;
  onClose: () => void;
  onDeploy: (id: string) => void;
  onReturn: (id: string) => void;
  onDissolve: (id: string) => void;
  invalidate: () => void;
  isPending: boolean;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [scanValue, setScanValue] = useState("");
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const parentLI = kit.lineItems[0];
  const children = (parentLI?.childLineItems ?? []) as ChildLineItem[];
  const canEdit = kit.status === "AVAILABLE";

  // Debounced search query
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (scanValue.trim().length >= 2) {
      searchTimerRef.current = setTimeout(() => {
        setDebouncedQuery(scanValue.trim());
        setShowResults(true);
      }, 300);
    } else {
      setDebouncedQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
      setShowResults(false); // eslint-disable-line react-hooks/set-state-in-effect
    }
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [scanValue]);

  const searchQuery = useQuery({
    queryKey: ["prep-kit-search", kit.id, debouncedQuery],
    queryFn: () => searchPrepKitItems(kit.id, debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  const addByTagMutation = useMutation({
    mutationFn: ({ assetTag, quantity }: { assetTag: string; quantity?: number }) =>
      addItemToPrepKitByTag(kit.id, assetTag, quantity),
    onSuccess: (result) => {
      const res = result as { success: boolean; error?: string; needsProjectAdd?: boolean; bulkAssetId?: string; modelId?: string; name?: string; assetTag?: string };
      if (res.success) {
        toast.success("Item added");
        invalidate();
      } else if (res.needsProjectAdd && res.modelId) {
        // No more on project — prompt to add more
        setConfirmAdd({
          name: res.name || "Item",
          assetTag: res.assetTag || "",
          bulkAssetId: res.bulkAssetId,
          modelId: res.modelId,
          quantity: 1,
          addToProjectQty: 1,
        });
      } else {
        toast.error(res.error || "Failed to add item");
      }
      setScanValue("");
    },
    onError: (err) => { toast.error(err.message); setScanValue(""); },
  });

  const addByIdMutation = useMutation({
    mutationFn: ({ lineItemId, quantity }: { lineItemId: string; quantity?: number }) =>
      addItemToPrepKit(kit.id, lineItemId, quantity),
    onSuccess: () => {
      toast.success("Item added");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  type PendingAdd = { name: string; assetTag: string; assetId?: string; bulkAssetId?: string; modelId: string; quantity?: number; addToProjectQty?: number };
  const [confirmAdd, setConfirmAdd] = useState<PendingAdd | null>(null);
  // Track quantity to add per bulk asset in search results
  const [bulkQtys, setBulkQtys] = useState<Record<string, number>>({});

  const addToProjectMutation = useMutation({
    mutationFn: (opts: { assetId?: string; bulkAssetId?: string; modelId: string; quantity?: number; addToProjectQty?: number }) =>
      addToPrepKitAndProject(kit.id, opts),
    onSuccess: (result) => {
      const res = result as { success: boolean };
      if (res.success) {
        toast.success("Added to project and prep-kit");
        invalidate();
      }
      setConfirmAdd(null);
    },
    onError: (err) => { toast.error(err.message); setConfirmAdd(null); },
  });

  const removeItemMutation = useMutation({
    mutationFn: ({ lineItemId, quantity }: { lineItemId: string; quantity?: number }) =>
      removeItemFromPrepKit(kit.id, lineItemId, quantity),
    onSuccess: () => { toast.success("Item removed"); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Dialog open={true} onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Container className="h-5 w-5" />
              <span className="truncate">{kit.name}</span>
              {!kit.assetTag.startsWith("PREP-") && (
                <span className="font-mono text-xs text-muted-foreground font-normal">{kit.assetTag}</span>
              )}
              <Badge variant="outline" className={`bg-purple-500/10 text-purple-500 border-purple-500/20`}>
                Prep
              </Badge>
              <Badge variant="outline" className={kitStatusColors[kit.status] || ""}>
                {kitStatusLabels[kit.status] || kit.status}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
            {/* Scan or search to add items */}
            {canEdit && (
              <div className="relative space-y-1">
                <Label className="text-xs text-muted-foreground">Scan or search to add items</Label>
                <ScanInput
                  placeholder="Scan asset tag or search by name..."
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && scanValue.trim()) {
                      e.preventDefault();
                      setShowResults(false);
                      addByTagMutation.mutate({ assetTag: scanValue.trim() });
                    }
                    if (e.key === "Escape") {
                      setShowResults(false);
                    }
                  }}
                  onFocus={() => { if (debouncedQuery.length >= 2) setShowResults(true); }}
                  onBlur={() => { setTimeout(() => setShowResults(false), 200); }}
                  onScan={(value) => addByTagMutation.mutate({ assetTag: value })}
                  scannerTitle="Scan asset to add to prep-kit"
                  continuous
                  disabled={addByTagMutation.isPending}
                  autoFocus
                />
                {/* Search results dropdown */}
                {showResults && searchQuery.data && (searchQuery.data as unknown[]).length > 0 && (
                  <div
                    ref={resultsRef}
                    className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto"
                  >
                    {(searchQuery.data as Array<{
                      type: "serialized" | "bulk";
                      assetTag: string;
                      name: string;
                      modelNumber: string | null;
                      scanTag: string;
                      onProject: boolean;
                      onProjectQty?: number;
                      availableQty?: number;
                      totalQty?: number;
                      assetId?: string;
                      bulkAssetId?: string;
                      modelId?: string;
                    }>).map((item, idx) => {
                      const key = `${item.type}-${item.assetTag || idx}`;
                      const isBulk = item.type === "bulk";
                      const onJobQty = item.onProjectQty ?? 0;
                      const availableQty = item.availableQty ?? 0;
                      const totalQty = item.totalQty ?? 0;
                      const qty = bulkQtys[key] ?? 1;

                      if (isBulk) {
                        // Bulk item with quantity picker — show on job / available
                        const maxQty = totalQty;
                        return (
                          <div
                            key={key}
                            className="flex items-center gap-2 px-3 py-2 text-sm"
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{item.name}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-2">
                                {item.assetTag && <span className="font-mono">{item.assetTag}</span>}
                                {item.modelNumber && <span>{item.modelNumber}</span>}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                <span>{onJobQty} on job</span>
                                <span className="mx-1">&middot;</span>
                                <span>{availableQty} available</span>
                                <span className="mx-1">&middot;</span>
                                <span>{totalQty} total</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={qty <= 1}
                                onClick={() => setBulkQtys((prev) => ({ ...prev, [key]: Math.max(1, qty - 1) }))}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center text-xs font-medium">{qty}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 w-6 p-0"
                                disabled={qty >= maxQty}
                                onClick={() => setBulkQtys((prev) => ({ ...prev, [key]: Math.min(maxQty, qty + 1) }))}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                className="h-6 px-2 ml-1"
                                onClick={() => {
                                  if (qty > onJobQty) {
                                    // Need to add more to the project first
                                    const addToProjectQty = qty - onJobQty;
                                    setConfirmAdd({
                                      name: item.name,
                                      assetTag: item.assetTag,
                                      bulkAssetId: item.bulkAssetId,
                                      modelId: item.modelId!,
                                      quantity: qty,
                                      addToProjectQty,
                                    });
                                    setShowResults(false);
                                  } else {
                                    addByTagMutation.mutate({ assetTag: item.scanTag, quantity: qty });
                                  }
                                  setBulkQtys((prev) => { const n = { ...prev }; delete n[key]; return n; });
                                }}
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      // Serialized items — simple click to add
                      return (
                        <button
                          key={key}
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (item.onProject) {
                              addByTagMutation.mutate({ assetTag: item.scanTag });
                            } else {
                              setConfirmAdd({
                                name: item.name,
                                assetTag: item.assetTag,
                                assetId: item.assetId,
                                modelId: item.modelId!,
                              });
                              setShowResults(false);
                            }
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{item.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              {item.assetTag && <span className="font-mono">{item.assetTag}</span>}
                              {item.modelNumber && <span>{item.modelNumber}</span>}
                              {!item.onProject && (
                                <span className="text-amber-500">Not on project</span>
                              )}
                            </div>
                          </div>
                          <PackagePlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Items list */}
            <div className="space-y-1">
              <div className="text-sm font-medium">
                Contents ({children.length} item{children.length !== 1 ? "s" : ""})
              </div>
              {children.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No items yet. Add project line items to this prep-kit.
                </p>
              ) : (
                <div className="divide-y">
                  {children.map((child) => {
                    const isNestedKit = !!child.kitId;
                    const isCaseAsset = !isNestedKit && !!child.asset && child.asset.assetTag === kit.assetTag;
                    const name = isNestedKit
                      ? (child.kit?.name || child.description || "Kit")
                      : (child.model?.name || child.description || "Item");
                    const tag = isNestedKit
                      ? (child.kit?.assetTag || "")
                      : (child.asset?.assetTag || child.bulkAsset?.assetTag || "");
                    const nestedChildren = (child.childLineItems ?? []) as ChildLineItem[];

                    return (
                      <div key={child.id}>
                        <div className="flex items-center gap-2 py-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-medium truncate">{name}</span>
                              {isNestedKit && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">Kit</Badge>
                              )}
                              {isCaseAsset && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 bg-purple-500/10 text-purple-500 border-purple-500/20">Case</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              {tag && <span className="font-mono text-xs">{tag}</span>}
                              {child.bulkAssetId && <span>x{child.quantity}</span>}
                              {isNestedKit && nestedChildren.length > 0 && (
                                <span className="text-xs">{nestedChildren.length} item{nestedChildren.length !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                          </div>
                          {canEdit && !isCaseAsset && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              {child.bulkAssetId && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-1.5 text-xs text-muted-foreground"
                                    onClick={() => removeItemMutation.mutate({ lineItemId: child.id, quantity: 1 })}
                                    disabled={removeItemMutation.isPending || child.quantity <= 1}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-1.5 text-xs text-muted-foreground"
                                    onClick={() => addByTagMutation.mutate({ assetTag: child.bulkAsset?.assetTag || "" })}
                                    disabled={addByTagMutation.isPending}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => removeItemMutation.mutate({ lineItemId: child.id })}
                                disabled={removeItemMutation.isPending}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                        {/* Nested kit children */}
                        {isNestedKit && nestedChildren.length > 0 && (
                          <div className="ml-5 pl-3 border-l border-border/50 mb-1">
                            {nestedChildren.map((nested) => {
                              const nestedName = nested.model?.name || nested.description || "Item";
                              const nestedTag = nested.asset?.assetTag || nested.bulkAsset?.assetTag || "";
                              return (
                                <div key={nested.id} className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                                  <div className="flex-1 min-w-0">
                                    <span className="truncate">{nestedName}</span>
                                    {nestedTag && <span className="font-mono ml-1.5">{nestedTag}</span>}
                                    {nested.bulkAssetId && <span className="ml-1">x{nested.quantity}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <DialogFooter className="flex-wrap gap-2">
            {kit.status === "AVAILABLE" && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (children.length === 0) {
                      onDissolve(kit.id);
                    } else if (confirmDissolve) {
                      onDissolve(kit.id);
                    } else {
                      setConfirmDissolve(true);
                    }
                  }}
                  disabled={isPending}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {confirmDissolve ? "Confirm Dissolve" : "Dissolve"}
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  onClick={() => onDeploy(kit.id)}
                  disabled={isPending || children.length === 0}
                >
                  <PackageX className="mr-1 h-3.5 w-3.5" />
                  Deploy
                </Button>
              </>
            )}
            {kit.status === "CHECKED_OUT" && (
              <>
                <div className="flex-1" />
                <Button
                  size="sm"
                  onClick={() => onReturn(kit.id)}
                  disabled={isPending}
                >
                  <PackageOpen className="mr-1 h-3.5 w-3.5" />
                  Return
                </Button>
              </>
            )}
            {(kit.status === "IN_MAINTENANCE" || kit.status === "INCOMPLETE") && (
              <>
                <div className="flex-1" />
                <Button
                  size="sm"
                  onClick={() => onDissolve(kit.id)}
                  disabled={isPending}
                >
                  <PackageOpen className="mr-1 h-3.5 w-3.5" />
                  Dissolve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm add to project dialog */}
      {confirmAdd && (
        <Dialog open={true} onOpenChange={() => setConfirmAdd(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Add to project?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {confirmAdd.addToProjectQty && confirmAdd.quantity ? (
                <>
                  <span className="font-medium text-foreground">{confirmAdd.addToProjectQty}x {confirmAdd.name}</span>
                  {" "}need to be added to the project first. Add {confirmAdd.quantity}x total to the prep-kit?
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{confirmAdd.name}</span>
                  {confirmAdd.assetTag && (
                    <span className="font-mono ml-1">({confirmAdd.assetTag})</span>
                  )}
                  {" "}is not on this project. Add it to the project and prep-kit?
                </>
              )}
            </p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setConfirmAdd(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  addToProjectMutation.mutate({
                    assetId: confirmAdd.assetId,
                    bulkAssetId: confirmAdd.bulkAssetId,
                    modelId: confirmAdd.modelId,
                    quantity: confirmAdd.quantity,
                    addToProjectQty: confirmAdd.addToProjectQty,
                  });
                }}
                disabled={addToProjectMutation.isPending}
              >
                {addToProjectMutation.isPending ? "Adding..." : "Add to project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
