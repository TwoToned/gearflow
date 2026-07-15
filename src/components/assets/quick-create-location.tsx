"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActiveOrganization } from "@/lib/auth-client";
import { useLocationWrites } from "@/hooks/use-location-writes";
import { useLocations } from "@/hooks/use-locations";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Loader2 } from "lucide-react";

interface QuickCreateLocationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function QuickCreateLocation({ open, onOpenChange, onCreated }: QuickCreateLocationProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"WAREHOUSE" | "VENUE" | "VEHICLE" | "OFFSITE">("WAREHOUSE");
  const [parentId, setParentId] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive location list from Convex.
  const locations = useLocations(orgId) ?? [];

  // Only top-level locations can be parents
  const parentOptions = locations
    .filter((loc) => !loc.parentId)
    .map((loc) => ({
      value: loc.id,
      label: loc.name,
      description: loc.type,
    }));

  const locWrites = useLocationWrites();
  const mutation = useServerMutation({
    mutationFn: () => locWrites.create({ name, type, parentId: parentId || null }),
    onSuccess: (result) => {
      toast.success("Location created");
      onCreated?.(result.id);
      onOpenChange(false);
      setName("");
      setType("WAREHOUSE");
      setParentId("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Location</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="quick-loc-name">Name</Label>
            <Input
              id="quick-loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Warehouse"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  mutation.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-loc-type">Type</Label>
            <select
              id="quick-loc-type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="WAREHOUSE">Warehouse</option>
              <option value="VENUE">Venue</option>
              <option value="VEHICLE">Vehicle</option>
              <option value="OFFSITE">Offsite</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Parent Location</Label>
            <ComboboxPicker
              value={parentId}
              onChange={setParentId}
              options={parentOptions}
              placeholder="None (top-level)"
              searchPlaceholder="Search locations..."
              allowClear
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
