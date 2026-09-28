"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useProjectContainerWrites } from "@/hooks/use-project-container-writes";
import { CONTAINER_KINDS, projectContainerSchema } from "@/lib/validations/project-container";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";

interface NewContainerSheetParentOption {
  id: string;
  label: string;
}

export interface NewContainerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Every container already on the job — the "Packed inside" parent picker's
   *  options (top-level containers only; nesting depth is capped at the build
   *  plan's cycle-check ceiling server-side, not re-enforced here). */
  existingContainers: NewContainerSheetParentOption[];
  onCreated: (container: { id: string; lineItemId: string; label: string }) => void;
}

type ContainerKindTab = (typeof CONTAINER_KINDS)[number];
type AssetSearchResult = { assetId: string; label: string; modelId: string | null; available: boolean };

/** Split out of `NewContainerSheet` (and `handleSubmit` below) to keep each
 *  function's branching under the complexity ratchet (R-3.6) — no behavior
 *  change, just less of it inline in the component/handler bodies. */
function buildAssetOptions(results: AssetSearchResult[] | undefined) {
  return (results ?? []).map((a) => ({
    value: a.assetId,
    label: a.label,
    badge: a.available ? undefined : <Badge status="warn">In use</Badge>,
  }));
}

function findAssetResult(results: AssetSearchResult[] | undefined, assetId: string): AssetSearchResult | undefined {
  return (results ?? []).find((a) => a.assetId === assetId);
}

function resolveContainerLabel(kind: ContainerKindTab, label: string, selectedAssetLabel: string | undefined): string {
  return kind === "CUSTOM" ? label.trim() : label.trim() || selectedAssetLabel || "Container";
}

/** Client-side check of the same bounds `projectContainersWrites.ts`'s
 *  `assertStrLen` enforces server-side — catches an over-length label/
 *  description before the round-trip, not a replacement for the server check. */
function validateContainerInput(input: {
  kind: ContainerKindTab;
  assetId?: string;
  label: string;
  description?: string;
  parentContainerId?: string;
}): { ok: true } | { ok: false; message: string } {
  const parsed = projectContainerSchema.safeParse(input);
  if (parsed.success) return { ok: true };
  return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid container details" };
}

/**
 * The "+ New" container sheet (#1296 build plan phase 2) — asset search (via
 * `containerAssetSearch`, several configured categories + the `isContainer`
 * model flag), a Custom tab for an unlabeled box, and a "Packed inside" parent
 * picker. Bulk-tub containers are deferred (D2) — the tab renders disabled
 * with a "later" note rather than a half-working picker.
 */
export function NewContainerSheet({
  open,
  onOpenChange,
  projectId,
  existingContainers,
  onCreated,
}: NewContainerSheetProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useProjectContainerWrites();

  const [kind, setKind] = useState<ContainerKindTab>("ASSET");
  const [assetQuery, setAssetQuery] = useState("");
  const debouncedAssetQuery = useDebouncedValue(assetQuery, 200);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [parentContainerId, setParentContainerId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const assetSearchArgs = orgId ? { orgId, query: debouncedAssetQuery } : "skip";
  const assetResults = useQuery(api.categories.containerAssetSearch, assetSearchArgs);
  const assetOptions = buildAssetOptions(assetResults);
  const selectedAsset = findAssetResult(assetResults, selectedAssetId);
  const selectedAssetLabel = selectedAsset?.label;

  const reset = () => {
    setKind("ASSET");
    setAssetQuery("");
    setSelectedAssetId("");
    setLabel("");
    setDescription("");
    setParentContainerId("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canSubmit = kind === "CUSTOM" ? label.trim().length > 0 : !!selectedAssetId;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    const resolvedLabel = resolveContainerLabel(kind, label, selectedAssetLabel);
    const validation = validateContainerInput({
      kind,
      assetId: kind === "ASSET" ? selectedAssetId : undefined,
      label: resolvedLabel,
      description: description.trim() || undefined,
      parentContainerId: parentContainerId || undefined,
    });
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    setSubmitting(true);
    try {
      const result = await writes.create({
        projectId,
        kind,
        label: resolvedLabel,
        assetId: kind === "ASSET" ? selectedAssetId : undefined,
        modelId: kind === "ASSET" ? selectedAsset?.modelId ?? undefined : undefined,
        description: description.trim() || undefined,
        parentContainerId: parentContainerId || undefined,
      });
      toast.success(`Created container "${resolvedLabel}"`);
      onCreated({ ...result, label: resolvedLabel });
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create container");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New container</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <Tabs value={kind} onValueChange={(v) => setKind(v as ContainerKindTab)}>
            <TabsList className="w-full">
              <TabsTrigger value="ASSET" className="flex-1">Asset</TabsTrigger>
              <TabsTrigger value="BULK_ASSET" className="flex-1" disabled>Bulk tub</TabsTrigger>
              <TabsTrigger value="CUSTOM" className="flex-1">Custom</TabsTrigger>
            </TabsList>

            <TabsContent value="ASSET" className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label htmlFor="container-asset">Container asset</Label>
                <ComboboxPicker
                  value={selectedAssetId}
                  onChange={setSelectedAssetId}
                  options={assetOptions}
                  placeholder="Search cases, tubs, road boxes..."
                  searchPlaceholder="Search or scan a tag..."
                  onSearchChange={setAssetQuery}
                  loading={assetResults === undefined}
                  selectedLabel={selectedAssetLabel}
                />
              </div>
            </TabsContent>

            <TabsContent value="BULK_ASSET" className="pt-3">
              <p className="text-caption text-muted">
                Bulk-tub containers aren&apos;t supported yet — use Custom for now.
              </p>
            </TabsContent>

            <TabsContent value="CUSTOM" className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label htmlFor="container-label">Label</Label>
                <Input
                  id="container-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Cardboard box 1"
                />
              </div>
            </TabsContent>
          </Tabs>

          {kind === "ASSET" && (
            <div className="space-y-2">
              <Label htmlFor="container-label-override">Label (optional override)</Label>
              <Input
                id="container-label-override"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={selectedAssetLabel || "Auto from selected asset"}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="container-description">Description</Label>
            <Textarea
              id="container-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes"
              rows={2}
            />
          </div>

          {existingContainers.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="container-parent">Packed inside (optional)</Label>
              <ComboboxPicker
                value={parentContainerId}
                onChange={setParentContainerId}
                options={existingContainers.map((c) => ({ value: c.id, label: c.label }))}
                placeholder="Top level"
                searchPlaceholder="Search containers..."
                allowClear
              />
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="line" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>Create</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
