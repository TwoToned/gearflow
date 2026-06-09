"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, ChevronRight, FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { useActiveOrganization } from "@/lib/auth-client";
import { getCategoryCounts, createCategory, updateCategory, deleteCategory } from "@/server/categories";
import { useCategories } from "@/hooks/use-categories";
import { getOrgTags } from "@/server/tags";
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

export function CategoryManager() {
  const queryClient = useQueryClient();
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
  const { data: categoryCounts } = useQuery({
    queryKey: ["category-counts", orgId],
    queryFn: () => getCategoryCounts(),
    enabled: !!orgId,
  });
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

  const { data: orgTags } = useQuery({
    queryKey: ["org-tags", orgId],
    queryFn: () => getOrgTags(),
  });

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", description: "", icon: "", sortOrder: 0 },
  });

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category created");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CategoryFormValues }) => updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category updated");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
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
    return <div className="text-sm text-fg-3">Loading categories...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Categories</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button size="sm" onClick={() => openCreate()} />}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Category" : "New Category"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cat-name">Name</Label>
                <Input id="cat-name" {...form.register("name")} placeholder="e.g. Audio" />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-icon">Icon</Label>
                <Input id="cat-icon" {...form.register("icon")} placeholder="e.g. 🎤" className="w-20" />
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
                <Label htmlFor="cat-sort">Sort Order</Label>
                <Input id="cat-sort" type="number" {...form.register("sortOrder")} className="w-24" />
              </div>
              {parentId && (
                <p className="text-xs text-fg-3">
                  Subcategory of: {categories.find((c) => c.id === parentId)?.name}
                </p>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" type="button" onClick={resetForm} />}>
                  Cancel
                </DialogClose>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {topLevel.length === 0 ? (
        <p className="text-sm text-fg-3">No categories yet. Create one to get started.</p>
      ) : (
        <div className="space-y-1">
          {topLevel.map((cat) => {
            const children = childrenOf(cat.id);
            return (
              <div key={cat.id}>
                <div className="flex items-center gap-2 rounded-md border p-2.5 hover:bg-accent/50">
                  <span className="text-base">{cat.icon || "📁"}</span>
                  <span className="font-medium text-sm flex-1">{cat.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {cat._count.models} models
                  </Badge>
                  {children.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {cat._count.children} sub
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openCreate(cat.id)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cat)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => setDeleteId(cat.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {children.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1">
                    {children.map((child) => (
                      <div key={child.id} className="flex items-center gap-2 rounded-md border border-dashed p-2 hover:bg-accent/50">
                        <ChevronRight className="h-3 w-3 text-fg-3" />
                        <span className="text-base">{child.icon || "📂"}</span>
                        <span className="text-sm flex-1">{child.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {child._count.models} models
                        </Badge>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(child)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
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
