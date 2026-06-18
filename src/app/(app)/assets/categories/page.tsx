"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Boxes, Container, FolderOpen, Folder, FolderTree, Search } from "lucide-react";
import { toast } from "sonner";

import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { getCategoryCounts, createCategory, updateCategory, deleteCategory } from "@/server/categories";
import { useCategories } from "@/hooks/use-categories";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
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
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/motion";
import { cn, focusRing } from "@/lib/utils";

export default function CategoriesPage() {
  const canCreate = useCanDo("model", "create");
  const canUpdate = useCanDo("model", "update");
  const canDelete = useCanDo("model", "delete");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Reactive category list straight from Convex (auto-updates on create/update/
  // delete). Model/kit counts stay cross-domain (Prisma) via a separate, non-
  // reactive query; children counts derive from the flat reactive list itself —
  // mirrors CategoryManager.
  const allCategories = useCategories(orgId);
  const isLoading = allCategories === undefined;
  const { data: categoryCounts } = useServerQuery({
    queryKey: ["category-counts", orgId],
    queryFn: () => getCategoryCounts(),
    enabled: !!orgId,
  });
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

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", description: "", icon: "", sortOrder: 0 },
  });

  const createMutation = useServerMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      toast.success("Category created");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useServerMutation({
    mutationFn: ({ id, data }: { id: string; data: CategoryFormValues }) => updateCategory(id, data),
    onSuccess: () => {
      toast.success("Category updated");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      toast.success("Category deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  function resetForm() {
    form.reset({ name: "", description: "", icon: "", sortOrder: 0 });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function openEdit(cat: any) {
    setEditingId(cat.id);
    setParentId(cat.parentId);
    form.reset({
      name: cat.name,
      description: cat.description || "",
      icon: cat.icon || "",
      sortOrder: cat.sortOrder,
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

  // Build flat list with parents followed by their children (indented)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topLevel = (categories as any[]).filter((c) => !c.parentId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childrenOf = (id: string) => (categories as any[]).filter((c) => c.parentId === id);

  // Build ordered rows: parent, then children, then next parent...
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: { category: any; depth: number }[] = [];
  for (const parent of topLevel) {
    rows.push({ category: parent, depth: 0 });
    for (const child of childrenOf(parent.id)) {
      rows.push({ category: child, depth: 1 });
    }
  }

  // Filter by search
  const filteredRows = search
    ? rows.filter((r) => r.category.name.toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <FadeIn>
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description="Group gear by type — audio, lighting, video, staging."
        actions={canCreate ? (
          <Button onClick={() => openCreate()}>
            <Plus className="h-4 w-4" />
            Add category
          </Button>
        ) : undefined}
      />

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <Input
            placeholder="Search categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[var(--r)] border border-line overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="hidden sm:table-cell">Description</TableHead>
              <TableHead className="text-right">Models</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Kits</TableHead>
              <TableHead className="text-right hidden md:table-cell">Subcategories</TableHead>
              <TableHead className="hidden lg:table-cell">Tags</TableHead>
              {(canUpdate || canDelete || canCreate) && (
                <TableHead className="w-[100px]"></TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell colSpan={7}>
                    <div className="h-5 w-full animate-pulse rounded-[8px] bg-elev" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <FolderOpen className="h-10 w-10 text-faint" />
                    <p className="text-ui-text text-ink-2">{search ? "No matching categories" : "No categories yet"}</p>
                    <p className="text-caption text-muted">
                      {search ? "Try a different search." : "Group your gear by type — audio, lighting, video, staging."}
                    </p>
                    {!search && canCreate && (
                      <Button size="sm" className="mt-2" onClick={() => openCreate()}>
                        <Plus className="h-4 w-4" />
                        Create first category
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map(({ category: cat, depth }) => (
                <TableRow key={cat.id}>
                  <TableCell>
                    <div className="flex items-center gap-2" style={{ paddingLeft: depth * 24 }}>
                      {cat.icon ? (
                        <span className="text-base">{cat.icon}</span>
                      ) : depth === 0 ? (
                        <Folder className="h-4 w-4 text-muted" />
                      ) : (
                        <FolderTree className="h-4 w-4 text-muted" />
                      )}
                      <Link
                        href={`/assets/categories/${cat.id}`}
                        className={cn("font-medium text-ink hover:text-red transition-colors rounded-sm", focusRing)}
                      >
                        {cat.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted max-w-[200px] truncate">
                    {cat.description || "\u2014"}
                  </TableCell>
                  <TableCell className="text-right t-data">
                    {cat._count.models > 0 ? (
                      <Badge status="neutral" className="gap-1">
                        <Boxes className="h-3 w-3" />
                        {cat._count.models}
                      </Badge>
                    ) : (
                      <span className="text-faint">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell t-data">
                    {cat._count.kits > 0 ? (
                      <Badge status="neutral" className="gap-1">
                        <Container className="h-3 w-3" />
                        {cat._count.kits}
                      </Badge>
                    ) : (
                      <span className="text-faint">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell t-data text-ink">
                    {cat._count.children > 0 ? cat._count.children : "\u2014"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {cat.tags?.map((tag: string) => (
                        <Badge key={tag} status="neutral">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  {(canUpdate || canDelete || canCreate) && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canCreate && depth === 0 && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openCreate(cat.id)} title="Add subcategory">
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canUpdate && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cat)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-t-out"
                            title="Delete"
                            onClick={() => setDeleteId(cat.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" {...form.register("name")} placeholder="e.g. Audio" aria-invalid={!!form.formState.errors.name} />
              {form.formState.errors.name && (
                <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-icon">Icon</Label>
              <Input id="cat-icon" {...form.register("icon")} placeholder="🎤" className="w-20" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea id="cat-desc" {...form.register("description")} placeholder="Optional description" rows={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-sort">Sort order</Label>
              <Input id="cat-sort" type="number" {...form.register("sortOrder")} className="w-24" />
            </div>
            {parentId && (
              <p className="text-caption text-muted">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                Subcategory of: {(categories as any[]).find((c) => c.id === parentId)?.name}
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
    </FadeIn>
  );
}
