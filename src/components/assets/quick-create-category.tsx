"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useActiveOrganization } from "@/lib/auth-client";
import { useCategoryWrites } from "@/hooks/use-category-writes";
import { useCategories } from "@/hooks/use-categories";
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

interface QuickCreateCategoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function QuickCreateCategory({ open, onOpenChange, onCreated }: QuickCreateCategoryProps) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive category list (Convex). Only top-level categories can be parents
  // (keep it to one level of nesting), sorted by sortOrder then name.
  const categories = useCategories(orgId);
  const parentOptions = useMemo(
    () =>
      [...(categories ?? [])]
        .filter((cat) => !cat.parentId)
        .sort((a, b) => {
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          return so !== 0 ? so : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        })
        .map((cat) => ({ value: cat.id, label: cat.name })),
    [categories],
  );

  const writes = useCategoryWrites();
  const mutation = useServerMutation({
    mutationFn: () => writes.create({ name, parentId: parentId || undefined }),
    onSuccess: (result) => {
      toast.success("Category created");
      onCreated?.(result.id);
      onOpenChange(false);
      setName("");
      setParentId("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Category</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="quick-cat-name">Name</Label>
            <Input
              id="quick-cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Microphones"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  mutation.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Parent Category</Label>
            <ComboboxPicker
              value={parentId}
              onChange={setParentId}
              options={parentOptions}
              placeholder="None (top-level)"
              searchPlaceholder="Search categories..."
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
