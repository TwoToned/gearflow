"use client";

import { useState } from "react";
import { toast } from "sonner";

import { cn, focusRing, disabledState } from "@/lib/utils";
import { useAssetWrites } from "@/hooks/use-asset-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrgTags } from "@/hooks/use-org-tags";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { TagInput } from "@/components/ui/tag-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { OUT_LABEL } from "@/lib/vocabulary";

/** The Assets list's bulk Edit… and Add tag… dialogs (moved verbatim from the retired AssetTable). */

export function BulkEditDialog({
  open,
  onOpenChange,
  selectedIds,
  locations,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>;
  locations: Array<{ id: string; name: string; type: string; parent?: { name: string } | null }>;
  onSuccess: () => void;
}) {
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");
  const [bulkLocationId, setBulkLocationId] = useState<string | undefined>(undefined);

  const assetWrites = useAssetWrites();
  const mutation = useServerMutation({
    mutationFn: () =>
      assetWrites.bulkUpdate(Array.from(selectedIds), {
        status: bulkStatus || undefined,
        condition: bulkCondition || undefined,
        locationId: bulkLocationId,
      }),
    onSuccess: (result) => {
      toast.success(`Updated ${result.count} assets`);
      setBulkStatus("");
      setBulkCondition("");
      setBulkLocationId(undefined);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const hasChanges = bulkStatus || bulkCondition || bulkLocationId !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk edit {selectedIds.size} assets</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-muted">
          Only fields you change will be updated. Leave a field unchanged to keep existing values.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Status</Label>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className={cn("flex h-11 w-full rounded-[var(--r)] border-2 border-line-2 bg-transparent px-3 py-1 text-ui-text text-ink", focusRing, disabledState)}
            >
              <option value="">— No change —</option>
              <option value="AVAILABLE">Available</option>
              <option value="CHECKED_OUT">{OUT_LABEL}</option>
              <option value="IN_MAINTENANCE">In maintenance</option>
              <option value="RESERVED">Reserved</option>
              <option value="RETIRED">Retired</option>
              <option value="LOST">Lost</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Condition</Label>
            <select
              value={bulkCondition}
              onChange={(e) => setBulkCondition(e.target.value)}
              className={cn("flex h-11 w-full rounded-[var(--r)] border-2 border-line-2 bg-transparent px-3 py-1 text-ui-text text-ink", focusRing, disabledState)}
            >
              <option value="">— No change —</option>
              <option value="NEW">New</option>
              <option value="GOOD">Good</option>
              <option value="FAIR">Fair</option>
              <option value="POOR">Poor</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <ComboboxPicker
              value={bulkLocationId ?? ""}
              onChange={(v) => setBulkLocationId(v)}
              options={locations.map((loc) => ({
                value: loc.id,
                label: loc.parent ? `${loc.parent.name} > ${loc.name}` : loc.name,
                description: loc.type,
              }))}
              placeholder="— No change —"
              searchPlaceholder="Search locations..."
              allowClear
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!hasChanges}>
            Update {selectedIds.size} assets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkAddTagsDialog({
  open,
  onOpenChange,
  selectedIds,
  orgId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>;
  orgId: string | undefined;
  onSuccess: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const orgTags = useOrgTags(orgId);
  const assetWrites = useAssetWrites();

  const mutation = useServerMutation({
    mutationFn: () => assetWrites.bulkTag(Array.from(selectedIds), tags),
    onSuccess: (result) => {
      toast.success(`Added tags to ${result.count} asset${result.count === 1 ? "" : "s"}`);
      setTags([]);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTags([]);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tags to {selectedIds.size} asset{selectedIds.size === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <p className="text-ui-text text-muted">
          Tags are appended — existing tags on each asset are kept. Duplicates are ignored.
        </p>
        <div className="space-y-2 py-2">
          <Label>Tags</Label>
          <TagInput value={tags} onChange={setTags} suggestions={orgTags} placeholder="Add tags…" />
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => { setTags([]); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={tags.length === 0}>
            Add to {selectedIds.size} asset{selectedIds.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
