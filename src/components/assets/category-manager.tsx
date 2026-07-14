"use client";

import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, ChevronRight, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCategoryWrites } from "@/hooks/use-category-writes";
import { useCategoryCounts } from "@/hooks/use-category-counts";
import { useCategories } from "@/hooks/use-categories";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useOrgTags } from "@/hooks/use-org-tags";
import { TagInput } from "@/components/ui/tag-input";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

export function CategoryManager() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive category list straight from Convex (auto-updates on any category
  // create/update/delete). Model/kit counts are cross-domain (still in Prisma) so
  // they come from a separate, non-reactive server query; children counts are
  // derived from the flat reactive list itself.
  const allCategories = useCategories(orgId);
  const categoryCounts = useCategoryCounts(orgId);
  const isLoading = allCategories === undefined;

  const categories = useMemo(() => {
    const source = allCategories ?? [];
    const childCount = new Map<string, number>();
    for (const c of source) if (c.parentId) childCount.set(c.parentId, (childCount.get(c.parentId) ?? 0) + 1);
    const sorted = [...source].sort((a, b) => {
      const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      return so !== 0 ? so : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return sorted.map((c) => ({
      ...c,
      _count: {
        models: categoryCounts?.[c.id]?.models ?? 0,
        kits: categoryCounts?.[c.id]?.kits ?? 0,
        children: childCount.get(c.id) ?? 0,
      },
    }));
  }, [allCategories, categoryCounts]);

  const orgTags = useOrgTags(orgId);

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", description: "", icon: "", sortOrder: 0 },
  });

  const writes = useCategoryWrites();
  const createMutation = useServerMutation({
    mutationFn: (data: CategoryFormValues) => writes.create(data),
    onSuccess: () => {
      toast.success("Category created");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: ({ id, data }: { id: string; data: CategoryFormValues }) => writes.update(id, data),
    onSuccess: () => {
      toast.success("Category updated");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: (id: string) => writes.remove(id),
    onSuccess: () => {
      toast.success("Category deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  function resetForm() {
    form.reset({ name: "", description: "", icon: "", sortOrder: 0, tags: [] });
    setEditingId(null);
    setParentId(null);
    setDialogOpen(false);
  }

  function openCreate(parentCategoryId?: string) {
    resetForm();
    if (parentCategoryId) {
      setParentId(parentCategoryId);
    }
    setDialogOpen(true);
  }

  function openEdit(cat: typeof categories[0]) {
    setEditingId(cat.id);
    setParentId(cat.parentId ?? null);
    form.reset({
      name: cat.name,
      description: cat.description || "",
      icon: cat.icon || "",
      sortOrder: cat.sortOrder ?? 0,
      tags: cat.tags ?? [],
    });
    setDialogOpen(true);
  }

  function onSubmit(data: CategoryFormValues) {
    const payload = { ...data, parentId };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  // Group categories: top-level and their children
  const topLevel = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  if (isLoading) {
    return (
      <div className="space-y-1">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-[var(--r)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-section-header font-semibold text-ink">Categories</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => openCreate()}>
              <Plus className="mr-2 h-4 w-4" />
              Add category
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit category" : "New category"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cat-name">Name</Label>
                <Input id="cat-name" {...form.register("name")} placeholder="e.g. Audio" aria-invalid={form.formState.errors.name ? true : undefined} />
                {form.formState.errors.name && (
                  <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-icon">Icon</Label>
                <Input id="cat-icon" {...form.register("icon")} placeholder="Emoji or short tag" className="w-32" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-desc">Description</Label>
                <Textarea id="cat-desc" {...form.register("description")} placeholder="Optional description" rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Tags</Label>
                <Controller
                  name="tags"
                  control={form.control}
                  render={({ field }) => (
                    <TagInput
                      value={field.value ?? []}
                      onChange={field.onChange}
                      suggestions={orgTags}
                      placeholder="Add tags..."
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-sort">Sort order</Label>
                <Input id="cat-sort" type="number" {...form.register("sortOrder")} className="w-24" />
              </div>
              {parentId && (
                <p className="text-caption text-muted">
                  Subcategory of: {categories.find((c) => c.id === parentId)?.name}
                </p>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="line" type="button" onClick={resetForm}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" loading={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {topLevel.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create one to start organising your gear."
          action={
            <Button size="sm" variant="line" onClick={() => openCreate()}>
              <Plus className="mr-2 h-4 w-4" />
              Add category
            </Button>
          }
        />
      ) : (
        <div className="space-y-1">
          {topLevel.map((cat) => {
            const children = childrenOf(cat.id);
            return (
              <div key={cat.id}>
                {/* Wraps: on a coarse pointer the three icon buttons are 44px each,
                    which with both badges overruns a 375px row. */}
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--r)] border-2 border-line-2 p-2.5 motion-safe:transition-colors hover:bg-elev">
                  {cat.icon ? (
                    <span className="text-base">{cat.icon}</span>
                  ) : (
                    <FolderOpen className="h-4 w-4 text-muted" />
                  )}
                  <span className="font-medium text-ui-text text-ink flex-1 min-w-0 truncate">{cat.name}</span>
                  <Badge status="neutral">
                    <span className="tabular-nums">{cat._count.models}</span> models
                  </Badge>
                  {children.length > 0 && (
                    <Badge status="neutral">
                      <span className="tabular-nums">{cat._count.children}</span> sub
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" className="touch-target size-8" aria-label="Add subcategory" onClick={() => openCreate(cat.id)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="touch-target size-8" aria-label="Edit category" onClick={() => openEdit(cat)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="touch-target size-8 text-muted hover:text-t-out"
                    aria-label="Delete category"
                    onClick={() => setDeleteId(cat.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {children.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1">
                    {children.map((child) => (
                      <div key={child.id} className="flex items-center gap-2 rounded-[var(--r)] border-2 border-dashed border-line-2 p-2 motion-safe:transition-colors hover:bg-elev">
                        <ChevronRight className="h-3 w-3 text-muted" />
                        {child.icon ? (
                          <span className="text-base">{child.icon}</span>
                        ) : (
                          <FolderOpen className="h-4 w-4 text-muted" />
                        )}
                        <span className="text-ui-text text-ink flex-1">{child.name}</span>
                        <Badge status="neutral">
                          <span className="tabular-nums">{child._count.models}</span> models
                        </Badge>
                        <Button variant="ghost" size="icon" className="touch-target size-8" aria-label="Edit subcategory" onClick={() => openEdit(child)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="touch-target size-8 text-muted hover:text-t-out"
                          aria-label="Delete subcategory"
                          onClick={() => setDeleteId(child.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <DeleteDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete this category?"
        description="Models, assets, and projects assigned to this category will be unlinked. Sub-categories under it will also be removed."
        confirmLabel="Delete category"
        onConfirm={() => {
          if (deleteId) {
            deleteMutation.mutate(deleteId);
            setDeleteId(null);
          }
        }}
        pending={deleteMutation.isPending}
      />
    </div>
  );
}
