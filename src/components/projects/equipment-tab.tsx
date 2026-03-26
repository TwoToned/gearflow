"use client";

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, FolderPlus } from "lucide-react";
import { toast } from "sonner";

import { getProjectCategories } from "@/server/project-categories";
import {
  createProjectGroup,
  updateGroupPrice,
  acceptSuggestedPrice,
  acceptAllSuggestedPrices,
  deleteProjectGroup,
  reorderProjectGroups,
  moveLineItemToGroup,
} from "@/server/project-groups";
import {
  createProjectCategory,
  reorderProjectCategories,
} from "@/server/project-categories";
import { getGroupTemplates, applyGroupTemplate } from "@/server/group-templates";
import { removeLineItem } from "@/server/line-items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/formatters";
import { CategorySection } from "./category-section";
import { GroupCard } from "./group-card";
import { AddEquipmentDialog } from "./add-equipment-dialog";

interface EquipmentTabProps {
  projectId: string;
}

// ─── Sortable wrapper for groups ─────────────────────────────────────────────

function SortableGroupCard({
  group,
  projectId,
  categoryId,
  onMutate,
  onAddEquipment,
}: {
  group: GroupData;
  projectId: string;
  categoryId: string;
  onMutate: () => void;
  onAddEquipment: (categoryId: string, groupId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Build compact pill summaries from line items
  const lineItemSummary = (group.lineItems ?? []).map((li) => ({
    modelName: li.model?.name ?? li.description,
    quantity: li.quantity,
  }));

  return (
    <div ref={setNodeRef} style={style}>
      <GroupCard
        id={group.id}
        title={group.title}
        description={group.description}
        quantity={group.quantity}
        price={group.price != null ? Number(group.price) : null}
        suggestedPrice={group.suggestedPrice != null ? Number(group.suggestedPrice) : null}
        rentalPeriod={group.rentalPeriod}
        rentalQuantity={group.rentalQuantity}
        lineItemCount={group.lineItems?.length ?? 0}
        lineItemSummary={lineItemSummary}
        dragHandleProps={{ ...attributes, ...listeners }}
        onAcceptSuggested={() => onMutate()}
        onEditPrice={() => onMutate()}
        onDelete={() => onMutate()}
        onAddEquipment={() => onAddEquipment(categoryId, group.id)}
      >
        <LineItemTable items={group.lineItems ?? []} projectId={projectId} onMutate={onMutate} />
      </GroupCard>
    </div>
  );
}

// ─── Line item table within a group ──────────────────────────────────────────

interface LineItemData {
  id: string;
  description: string | null;
  quantity: number;
  unitPrice: unknown;
  lineTotal: unknown;
  model?: { name: string; dailyRate?: unknown; weeklyRate?: unknown } | null;
  asset?: { assetTag?: string | null } | null;
}

function LineItemTable({
  items,
  projectId,
  onMutate,
}: {
  items: LineItemData[];
  projectId: string;
  onMutate: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-fg-4">
        No items in this group yet. Add equipment to get started.
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-3 rounded px-2 py-1.5 text-xs hover:bg-bg-inset/50"
        >
          <span className="min-w-0 flex-1 truncate text-fg-2">
            {item.model?.name ?? item.description ?? "—"}
          </span>
          {item.asset?.assetTag && (
            <span className="flex-none text-fg-4">{item.asset.assetTag}</span>
          )}
          <span className="flex-none tabular-nums text-fg-3">×{item.quantity}</span>
          <span className="flex-none tabular-nums text-fg-2">
            {formatCurrency(item.unitPrice != null ? Number(item.unitPrice) : null)}
          </span>
          <span className="w-20 flex-none text-right tabular-nums font-medium text-fg">
            {formatCurrency(item.lineTotal != null ? Number(item.lineTotal) : null)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface GroupData {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  price: unknown;
  suggestedPrice: unknown;
  rentalPeriod: string | null;
  rentalQuantity: number | null;
  sortOrder: number;
  lineItems?: LineItemData[];
}

interface CategoryData {
  id: string;
  name: string;
  sortOrder: number;
  groups: GroupData[];
  lineItems?: LineItemData[];
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EquipmentTab({ projectId }: EquipmentTabProps) {
  const queryClient = useQueryClient();
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [addEquipmentTarget, setAddEquipmentTarget] = useState<{
    categoryId?: string;
    groupId?: string;
  }>({});

  // Price edit dialog state
  const [priceEditGroupId, setPriceEditGroupId] = useState<string | null>(null);
  const [priceEditValue, setPriceEditValue] = useState("");

  // Delete confirmation state
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteGroupInfo, setDeleteGroupInfo] = useState<{
    title: string;
    price: number;
    itemCount: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const queryKey = ["project-categories", projectId];

  const { data: categories = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getProjectCategories(projectId),
    staleTime: 60_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["group-templates"],
    queryFn: () => getGroupTemplates(),
    staleTime: 60_000,
  });

  const templateOptions = (templates as { id: string; name: string; description: string | null; items: unknown[] }[]).map(
    (t) => ({ id: t.id, name: t.name, description: t.description, itemCount: t.items.length })
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, queryKey, projectId]);

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createCategoryMut = useMutation({
    mutationFn: (name: string) => createProjectCategory(projectId, { name }),
    onSuccess: () => {
      invalidate();
      setShowAddCategory(false);
      setNewCategoryName("");
      toast.success("Category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createGroupMut = useMutation({
    mutationFn: ({ categoryId, title, templateId }: { categoryId: string; title: string; templateId?: string }) => {
      if (templateId) {
        return applyGroupTemplate(projectId, { templateId, categoryId, title });
      }
      return createProjectGroup(projectId, { categoryId, title, quantity: 1 });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Group created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePriceMut = useMutation({
    mutationFn: ({ groupId, price }: { groupId: string; price: number }) =>
      updateGroupPrice(groupId, price),
    onSuccess: () => {
      invalidate();
      setPriceEditGroupId(null);
      toast.success("Price updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptPriceMut = useMutation({
    mutationFn: (groupId: string) => acceptSuggestedPrice(groupId),
    onSuccess: () => {
      invalidate();
      toast.success("Price accepted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const acceptAllPricesMut = useMutation({
    mutationFn: (categoryId: string) => acceptAllSuggestedPrices(projectId, categoryId),
    onSuccess: (data) => {
      invalidate();
      toast.success(`Accepted prices for ${(data as { count: number }).count} group(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteGroupMut = useMutation({
    mutationFn: (groupId: string) => deleteProjectGroup(groupId),
    onSuccess: () => {
      invalidate();
      setDeleteGroupId(null);
      setDeleteGroupInfo(null);
      toast.success("Group deleted — items moved to standalone");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── DnD handlers ─────────────────────────────────────────────────────────

  function handleGroupDragEnd(categoryId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const cat = (categories as CategoryData[]).find((c) => c.id === categoryId);
    if (!cat) return;

    const oldIndex = cat.groups.findIndex((g) => g.id === active.id);
    const newIndex = cat.groups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...cat.groups];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    reorderProjectGroups(categoryId, reordered.map((g) => g.id)).catch(() => {
      toast.error("Failed to reorder groups");
    });
    invalidate();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-fg-4">
        Loading equipment...
      </div>
    );
  }

  const typedCategories = categories as CategoryData[];
  const hasCategories = typedCategories.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAddCategory(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Add category
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setAddEquipmentTarget({});
            setShowAddEquipment(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add equipment
        </Button>
      </div>

      {/* Categories */}
      {!hasCategories && (
        <div className="rounded-lg border border-dashed border-foreground/10 py-12 text-center">
          <p className="text-sm text-fg-3">No categories yet.</p>
          <p className="mt-1 text-xs text-fg-4">
            Create a category (e.g. "RF", "IEM", "PA") to organize your equipment.
          </p>
        </div>
      )}

      {typedCategories.map((cat) => {
        const categoryTotal = cat.groups.reduce((sum, g) => {
          const price = g.price != null ? Number(g.price) : 0;
          return sum + price * g.quantity;
        }, 0) + (cat.lineItems ?? []).reduce((sum, li) => {
          return sum + (li.lineTotal != null ? Number(li.lineTotal) : 0);
        }, 0);

        return (
          <CategorySection
            key={cat.id}
            id={cat.id}
            name={cat.name}
            groupCount={cat.groups.length}
            standaloneCount={cat.lineItems?.length ?? 0}
            categoryTotal={categoryTotal}
            onAddGroup={(title, templateId) =>
              createGroupMut.mutate({ categoryId: cat.id, title, templateId })
            }
            templates={templateOptions}
            onAcceptAllPrices={() => acceptAllPricesMut.mutate(cat.id)}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={(e) => handleGroupDragEnd(cat.id, e)}
            >
              <SortableContext
                items={cat.groups.map((g) => g.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {cat.groups.map((group) => (
                    <SortableGroupCard
                      key={group.id}
                      group={group}
                      projectId={projectId}
                      categoryId={cat.id}
                      onMutate={invalidate}
                      onAddEquipment={(catId, grpId) => {
                        setAddEquipmentTarget({ categoryId: catId, groupId: grpId });
                        setShowAddEquipment(true);
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {/* Standalone line items */}
            {(cat.lineItems ?? []).length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-4 mb-1">
                  Standalone items
                </div>
                <LineItemTable
                  items={cat.lineItems ?? []}
                  projectId={projectId}
                  onMutate={invalidate}
                />
              </div>
            )}
          </CategorySection>
        );
      })}

      {/* Add category dialog */}
      <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New category</DialogTitle>
            <DialogDescription>
              Categories organize equipment into sections (e.g. RF, IEM, PA).
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Category name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCategoryName.trim()) {
                createCategoryMut.mutate(newCategoryName.trim());
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddCategory(false);
                setNewCategoryName("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createCategoryMut.mutate(newCategoryName.trim())}
              disabled={!newCategoryName.trim() || createCategoryMut.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price edit dialog */}
      <Dialog
        open={priceEditGroupId != null}
        onOpenChange={(open) => {
          if (!open) setPriceEditGroupId(null);
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Set group price</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-fg-3">$</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={priceEditValue}
              onChange={(e) => setPriceEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && priceEditGroupId) {
                  updatePriceMut.mutate({
                    groupId: priceEditGroupId,
                    price: parseFloat(priceEditValue) || 0,
                  });
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceEditGroupId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (priceEditGroupId) {
                  updatePriceMut.mutate({
                    groupId: priceEditGroupId,
                    price: parseFloat(priceEditValue) || 0,
                  });
                }
              }}
              disabled={updatePriceMut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteGroupId != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupId(null);
            setDeleteGroupInfo(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteGroupInfo?.title}&rdquo;?
            </DialogDescription>
          </DialogHeader>
          {deleteGroupInfo && (
            <div className="rounded-lg bg-bg-inset p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-fg-3">Items</span>
                <span className="text-fg-2">{deleteGroupInfo.itemCount} will become standalone</span>
              </div>
              {deleteGroupInfo.price > 0 && (
                <div className="flex justify-between">
                  <span className="text-fg-3">Revenue impact</span>
                  <span className="font-medium text-[oklch(0.58_0.22_27)]">
                    -{formatCurrency(deleteGroupInfo.price)}
                  </span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteGroupId(null);
                setDeleteGroupInfo(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteGroupId && deleteGroupMut.mutate(deleteGroupId)}
              disabled={deleteGroupMut.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add equipment dialog */}
      {showAddEquipment && (
        <AddEquipmentDialog
          projectId={projectId}
          open={showAddEquipment}
          onOpenChange={setShowAddEquipment}
          categoryId={addEquipmentTarget.categoryId}
          groupId={addEquipmentTarget.groupId}
        />
      )}
    </div>
  );
}
