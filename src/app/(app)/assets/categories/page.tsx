"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Boxes, Container, FolderOpen, Search } from "lucide-react";
import { toast } from "sonner";

import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { getCategories, createCategory, updateCategory, deleteCategory } from "@/server/categories";
import { Button } from "@/components/ui/button";
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

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const canCreate = useCanDo("model", "create");
  const canUpdate = useCanDo("model", "update");
  const canDelete = useCanDo("model", "delete");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["categories", orgId],
    queryFn: () => getCategories(),
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
    <div className="space-y-4">
      <PageHeader
        title="Categories"
        description="Group gear by type — audio, lighting, video, staging."
        actions={canCreate ? (
          <Button onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        ) : undefined}
      />

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-fg-3" />
          <Input
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
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
              <TableRow>
                <TableCell colSpan={7} className="text-center text-fg-3">Loading...</TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-fg-3 py-12">
                  <div className="flex flex-col items-center gap-2">
                    <FolderOpen className="h-10 w-10 text-fg-3/50" />
                    <p>{search ? "No matching categories." : "No categories yet."}</p>
                    {!search && canCreate && (
                      <Button size="sm" className="mt-2" onClick={() => openCreate()}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create First Category
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
                      <span className="text-base">{cat.icon || (depth === 0 ? "📁" : "📂")}</span>
                      <Link
                        href={`/assets/categories/${cat.id}`}
                        className="font-medium hover:text-primary transition-colors"
                      >
                        {cat.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-fg-3 max-w-[200px] truncate">
                    {cat.description || "\u2014"}
                  </TableCell>
                  <TableCell className="text-right">
                    {cat._count.models > 0 ? (
                      <Badge variant="secondary" className="gap-1">
                        <Boxes className="h-3 w-3" />
                        {cat._count.models}
                      </Badge>
                    ) : (
                      <span className="text-fg-3">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell">
                    {cat._count.kits > 0 ? (
                      <Badge variant="secondary" className="gap-1">
                        <Container className="h-3 w-3" />
                        {cat._count.kits}
                      </Badge>
                    ) : (
                      <span className="text-fg-3">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell">
                    {cat._count.children > 0 ? cat._count.children : "\u2014"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {cat.tags?.map((tag: string) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
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
                            className="h-7 w-7 text-destructive"
                            title="Delete"
                            onClick={() => {
                              if (confirm("Delete this category?")) deleteMutation.mutate(cat.id);
                            }}
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
              <Label htmlFor="cat-icon">Icon (emoji)</Label>
              <Input id="cat-icon" {...form.register("icon")} placeholder="e.g. 🎤" className="w-20" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea id="cat-desc" {...form.register("description")} placeholder="Optional description" rows={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-sort">Sort Order</Label>
              <Input id="cat-sort" type="number" {...form.register("sortOrder")} className="w-24" />
            </div>
            {parentId && (
              <p className="text-xs text-fg-3">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                Subcategory of: {(categories as any[]).find((c) => c.id === parentId)?.name}
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
  );
}
