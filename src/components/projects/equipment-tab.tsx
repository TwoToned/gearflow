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
import { Plus, FolderPlus, Package, ArrowUpRight, MoreHorizontal, Trash2, Pencil, Loader2, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

import { getProjectCategories } from "@/server/project-categories";
import {
  createProjectGroup,
  updateProjectGroup,
  updateGroupPrice,
  deleteProjectGroup,
  reorderProjectGroups,
  moveLineItemToGroup,
} from "@/server/project-groups";
import {
  createProjectCategory,
  reorderProjectCategories,
  getUncategorizedLineItems,
} from "@/server/project-categories";
import { getGroupTemplates, applyGroupTemplate } from "@/server/group-templates";
import { removeLineItem, updateLineItem, addKitLineItem, checkKitAvailability } from "@/server/line-items";
import { getKits } from "@/server/kits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { formatCurrency } from "@/lib/formatters";
import { useActiveOrganization } from "@/lib/auth-client";
import { CategorySection } from "./category-section";
import { GroupCard } from "./group-card";
import { AddEquipmentDialog } from "./add-equipment-dialog";
import { AddSubhireDialog } from "./add-subhire-dialog";

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
  onAddKit,
  onAddSubhire,
  onEditPrice,
  onDelete,
  onEdit,
  onEditLineItem,
  onMoveLineItem,
}: {
  group: GroupData;
  projectId: string;
  categoryId: string;
  onMutate: () => void;
  onAddEquipment: (categoryId: string, groupId: string, groupTitle: string) => void;
  onAddKit: (categoryId: string, groupId: string, groupTitle: string) => void;
  onAddSubhire: (categoryId: string, groupId: string, groupTitle: string) => void;
  onEditPrice: (groupId: string, currentPrice: number | null) => void;
  onEditLineItem: (item: LineItemData) => void;
  onMoveLineItem: (itemId: string) => void;
  onDelete: (groupId: string, title: string, price: number, itemCount: number) => void;
  onEdit: (group: GroupData) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priceVal = group.price != null ? Number(group.price) : null;

  return (
    <div ref={setNodeRef} style={style}>
      <GroupCard
        id={group.id}
        title={group.title}
        description={group.description}
        quantity={group.quantity}
        price={priceVal}
        suggestedPrice={group.suggestedPrice != null ? Number(group.suggestedPrice) : null}
        rentalPeriod={group.rentalPeriod}
        rentalQuantity={group.rentalQuantity}
        lineItemCount={group.lineItems?.length ?? 0}
        dragHandleProps={{ ...attributes, ...listeners }}
        onEditPrice={() => onEditPrice(group.id, priceVal)}
        onDelete={() => onDelete(group.id, group.title, priceVal ?? 0, group.lineItems?.length ?? 0)}
        onEdit={() => onEdit(group)}
        onAddEquipment={() => onAddEquipment(categoryId, group.id, group.title)}
        onAddKit={() => onAddKit(categoryId, group.id, group.title)}
        onAddSubhire={() => onAddSubhire(categoryId, group.id, group.title)}
      >
        <LineItemTable items={group.lineItems ?? []} projectId={projectId} onMutate={onMutate} onEditItem={onEditLineItem} onMoveItem={onMoveLineItem} />
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
  pricingType?: string;
  duration?: number;
  notes?: string | null;
  isOptional?: boolean;
  type?: string;
  model?: { name: string; dailyRate?: unknown; weeklyRate?: unknown } | null;
  asset?: { assetTag?: string | null } | null;
}

function LineItemTable({
  items,
  projectId,
  onMutate,
  onEditItem,
  onMoveItem,
}: {
  items: LineItemData[];
  projectId: string;
  onMutate: () => void;
  onEditItem?: (item: LineItemData) => void;
  onMoveItem?: (itemId: string) => void;
}) {
  const removeMut = useMutation({
    mutationFn: (id: string) => removeLineItem(id),
    onSuccess: () => {
      onMutate();
      toast.success("Item removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
          className="group/item flex items-center gap-3 rounded px-2 py-1.5 text-xs hover:bg-bg-inset/50"
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
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-6 w-6 flex-none opacity-0 group-hover/item:opacity-100 transition-opacity" />}>
              <MoreHorizontal className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Item</DropdownMenuLabel>
                {onEditItem && (
                  <DropdownMenuItem onClick={() => onEditItem(item)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Edit
                  </DropdownMenuItem>
                )}
                {onMoveItem && (
                  <DropdownMenuItem onClick={() => onMoveItem(item.id)}>
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                    Move to...
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => removeMut.mutate(item.id)}
                  className="text-[oklch(0.58_0.22_27)]"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
  billingWeeks: number | null;
  billingDays: number | null;
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
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [addEquipmentTarget, setAddEquipmentTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
  }>({});

  // Kit dialog state
  const [showKitDialog, setShowKitDialog] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState("");
  const [kitPricingMode, setKitPricingMode] = useState<"KIT_PRICE" | "ITEMIZED">("KIT_PRICE");
  const [kitUnitPrice, setKitUnitPrice] = useState("");

  // Subhire dialog state
  const [showSubhireDialog, setShowSubhireDialog] = useState(false);
  const [subhireTarget, setSubhireTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
  }>({});

  // Kit target state (for adding kits to specific groups)
  const [kitTarget, setKitTarget] = useState<{
    categoryId?: string;
    groupId?: string;
    label?: string;
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

  // Move line item dialog state
  const [moveLineItemId, setMoveLineItemId] = useState<string | null>(null);
  const [moveTargetGroupId, setMoveTargetGroupId] = useState<string>("__uncategorized__");

  // Line item edit dialog state
  const [editLineItem, setEditLineItem] = useState<LineItemData | null>(null);
  const [editQuantity, setEditQuantity] = useState("1");
  const [editUnitPrice, setEditUnitPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPricingType, setEditPricingType] = useState("PER_DAY");
  const [editDuration, setEditDuration] = useState("1");
  const [editNotes, setEditNotes] = useState("");

  // Group edit dialog state
  const [editGroupData, setEditGroupData] = useState<GroupData | null>(null);
  const [editGroupTitle, setEditGroupTitle] = useState("");
  const [editGroupDescription, setEditGroupDescription] = useState("");
  const [editGroupQuantity, setEditGroupQuantity] = useState("1");
  const [editGroupBillingWeeks, setEditGroupBillingWeeks] = useState("");
  const [editGroupBillingDays, setEditGroupBillingDays] = useState("");

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

  const { data: uncategorizedItems = [] } = useQuery({
    queryKey: ["uncategorized-items", projectId],
    queryFn: () => getUncategorizedLineItems(projectId),
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
    queryClient.invalidateQueries({ queryKey: ["uncategorized-items", projectId] });
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

  const moveLineItemMut = useMutation({
    mutationFn: ({ lineItemId, targetGroupId, targetCategoryId }: {
      lineItemId: string;
      targetGroupId: string | null;
      targetCategoryId: string | null;
    }) => moveLineItemToGroup({ lineItemId, targetGroupId, targetCategoryId }),
    onSuccess: () => {
      invalidate();
      setMoveLineItemId(null);
      toast.success("Item moved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateLineItemMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateLineItem(id, data as Parameters<typeof updateLineItem>[1]),
    onSuccess: () => {
      invalidate();
      setEditLineItem(null);
      toast.success("Item updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openEditLineItem(item: LineItemData) {
    setEditLineItem(item);
    setEditQuantity(String(item.quantity));
    setEditUnitPrice(item.unitPrice != null ? String(Number(item.unitPrice)) : "");
    setEditDescription(item.description ?? item.model?.name ?? "");
    setEditPricingType(item.pricingType ?? "PER_DAY");
    setEditDuration(String(item.duration ?? 1));
    setEditNotes(item.notes ?? "");
  }

  function handleSaveEditLineItem() {
    if (!editLineItem) return;
    updateLineItemMut.mutate({
      id: editLineItem.id,
      data: {
        type: editLineItem.type ?? "EQUIPMENT",
        quantity: Number(editQuantity) || 1,
        unitPrice: editUnitPrice ? Number(editUnitPrice) : undefined,
        description: editDescription,
        pricingType: editPricingType,
        duration: Number(editDuration) || 1,
        notes: editNotes || undefined,
      },
    });
  }

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

  const updateGroupMut = useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: Partial<{ title: string; description: string; quantity: number; billingWeeks: number; billingDays: number }> }) =>
      updateProjectGroup(groupId, data),
    onSuccess: () => {
      invalidate();
      setEditGroupData(null);
      toast.success("Group updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Kit queries and mutations
  const { data: kitsData } = useQuery({
    queryKey: ["kits", orgId],
    queryFn: () => getKits({ pageSize: 200 }),
    enabled: showKitDialog,
  });

  const { data: kitAvailability } = useQuery({
    queryKey: ["kit-availability", orgId, selectedKitId, projectId],
    queryFn: () => checkKitAvailability(selectedKitId, new Date(), new Date(), projectId),
    enabled: showKitDialog && !!selectedKitId,
  });

  const addKitMut = useMutation({
    mutationFn: () =>
      addKitLineItem(
        projectId,
        selectedKitId,
        kitPricingMode,
        kitPricingMode === "KIT_PRICE" && kitUnitPrice ? parseFloat(kitUnitPrice) : undefined,
        undefined, // groupName
        kitTarget.categoryId,
        kitTarget.groupId,
      ),
    onSuccess: () => {
      invalidate();
      setShowKitDialog(false);
      setSelectedKitId("");
      setKitPricingMode("KIT_PRICE");
      setKitUnitPrice("");
      setKitTarget({});
      toast.success("Kit added to project");
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
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setAddEquipmentTarget({});
            setShowAddEquipment(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Equipment
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setKitTarget({});
            setShowKitDialog(true);
          }}
        >
          <Package className="h-3.5 w-3.5" />
          Add Kit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setSubhireTarget({});
            setShowSubhireDialog(true);
          }}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Add Subhire
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowAddCategory(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Add Category
        </Button>
      </div>

      {/* Categories */}
      {!hasCategories && (uncategorizedItems as LineItemData[]).length === 0 && (
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
                      onAddEquipment={(catId, grpId, grpTitle) => {
                        setAddEquipmentTarget({ categoryId: catId, groupId: grpId, label: `${cat.name} > ${grpTitle}` });
                        setShowAddEquipment(true);
                      }}
                      onAddKit={(catId, grpId, grpTitle) => {
                        setKitTarget({ categoryId: catId, groupId: grpId, label: `${cat.name} > ${grpTitle}` });
                        setShowKitDialog(true);
                      }}
                      onAddSubhire={(catId, grpId, grpTitle) => {
                        setSubhireTarget({ categoryId: catId, groupId: grpId, label: `${cat.name} > ${grpTitle}` });
                        setShowSubhireDialog(true);
                      }}
                      onEditPrice={(groupId, currentPrice) => {
                        setPriceEditGroupId(groupId);
                        setPriceEditValue(currentPrice != null ? String(currentPrice) : "");
                      }}
                      onDelete={(groupId, title, price, itemCount) => {
                        setDeleteGroupId(groupId);
                        setDeleteGroupInfo({ title, price, itemCount });
                      }}
                      onEdit={(g) => {
                        setEditGroupData(g);
                        setEditGroupTitle(g.title);
                        setEditGroupDescription(g.description ?? "");
                        setEditGroupQuantity(String(g.quantity));
                        setEditGroupBillingWeeks(g.billingWeeks != null ? String(g.billingWeeks) : "");
                        setEditGroupBillingDays(g.billingDays != null ? String(g.billingDays) : "");
                      }}
                      onEditLineItem={openEditLineItem}
                      onMoveLineItem={(id) => { setMoveLineItemId(id); setMoveTargetGroupId("__uncategorized__"); }}
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
                  onEditItem={openEditLineItem}
                  onMoveItem={(id) => { setMoveLineItemId(id); setMoveTargetGroupId("__uncategorized__"); }}
                />
              </div>
            )}
          </CategorySection>
        );
      })}

      {/* Uncategorized items */}
      {(uncategorizedItems as LineItemData[]).length > 0 && (
        <div className="rounded-lg bg-bg-surface ring-1 ring-foreground/8">
          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-fg">Uncategorized</span>
              <span className="text-xs text-fg-4">
                {(uncategorizedItems as LineItemData[]).length} item{(uncategorizedItems as LineItemData[]).length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setAddEquipmentTarget({});
                  setShowAddEquipment(true);
                }}
                className="flex items-center gap-1 text-xs text-fg-4 hover:text-fg-3 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Equipment
              </button>
            </div>
          </div>
          <div className="border-t border-foreground/5 px-3 pb-3 pt-2">
            <LineItemTable items={uncategorizedItems as LineItemData[]} projectId={projectId} onMutate={invalidate} onEditItem={openEditLineItem} onMoveItem={(id) => { setMoveLineItemId(id); setMoveTargetGroupId("__uncategorized__"); }} />
          </div>
        </div>
      )}

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

      {/* Edit line item dialog */}
      <Dialog open={editLineItem != null} onOpenChange={(open) => { if (!open) setEditLineItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-quantity">Quantity</Label>
                <Input
                  id="edit-quantity"
                  type="number"
                  min={1}
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-unitPrice">Unit Price ($)</Label>
                <Input
                  id="edit-unitPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  value={editUnitPrice}
                  onChange={(e) => setEditUnitPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-pricingType">Pricing Type</Label>
                <select
                  id="edit-pricingType"
                  value={editPricingType}
                  onChange={(e) => setEditPricingType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="PER_DAY">Per Day</option>
                  <option value="PER_WEEK">Per Week</option>
                  <option value="FLAT">Flat</option>
                  <option value="PER_HOUR">Per Hour</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-duration">Duration</Label>
                <Input
                  id="edit-duration"
                  type="number"
                  min={1}
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLineItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEditLineItem} disabled={updateLineItemMut.isPending}>
              {updateLineItemMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move line item dialog */}
      <Dialog open={moveLineItemId != null} onOpenChange={(open) => { if (!open) setMoveLineItemId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move Item</DialogTitle>
            <DialogDescription>
              Choose a destination group for this item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <select
              value={moveTargetGroupId}
              onChange={(e) => setMoveTargetGroupId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="__uncategorized__">Uncategorized (no group)</option>
              {typedCategories.map((cat) =>
                cat.groups.map((g) => (
                  <option key={g.id} value={`${cat.id}|${g.id}`}>
                    {cat.name} &gt; {g.title}
                  </option>
                ))
              )}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveLineItemId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!moveLineItemId) return;
                if (moveTargetGroupId === "__uncategorized__") {
                  moveLineItemMut.mutate({ lineItemId: moveLineItemId, targetGroupId: null, targetCategoryId: null });
                } else {
                  const [catId, grpId] = moveTargetGroupId.split("|");
                  moveLineItemMut.mutate({ lineItemId: moveLineItemId, targetGroupId: grpId, targetCategoryId: catId });
                }
              }}
              disabled={moveLineItemMut.isPending}
            >
              {moveLineItemMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move
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
          targetLabel={addEquipmentTarget.label}
        />
      )}

      {/* Add subhire dialog */}
      <AddSubhireDialog
        projectId={projectId}
        open={showSubhireDialog}
        onOpenChange={(open) => {
          setShowSubhireDialog(open);
          if (!open) setSubhireTarget({});
        }}
        categoryId={subhireTarget.categoryId}
        groupId={subhireTarget.groupId}
        targetLabel={subhireTarget.label}
      />

      {/* Add kit dialog */}
      <Dialog
        open={showKitDialog}
        onOpenChange={(open) => {
          setShowKitDialog(open);
          if (!open) {
            setSelectedKitId("");
            setKitPricingMode("KIT_PRICE");
            setKitUnitPrice("");
            setKitTarget({});
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Kit to Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Kit</Label>
              <ComboboxPicker
                value={selectedKitId}
                onChange={setSelectedKitId}
                options={(kitsData?.kits || []).map((kit: { id: string; assetTag: string; name: string; category?: { name: string } | null }) => ({
                  value: kit.id,
                  label: `${kit.assetTag} - ${kit.name}`,
                  description: kit.category?.name,
                }))}
                placeholder="Select a kit..."
                searchPlaceholder="Search kits..."
                emptyMessage="No kits found."
              />
            </div>

            {selectedKitId && kitAvailability && !kitAvailability.available && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                Kit is unavailable: {kitAvailability.conflictsWith}
              </div>
            )}

            <div className="space-y-2">
              <Label>Pricing Mode</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="kitPricingMode"
                    value="KIT_PRICE"
                    checked={kitPricingMode === "KIT_PRICE"}
                    onChange={() => setKitPricingMode("KIT_PRICE")}
                    className="accent-primary"
                  />
                  Kit Price
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="kitPricingMode"
                    value="ITEMIZED"
                    checked={kitPricingMode === "ITEMIZED"}
                    onChange={() => setKitPricingMode("ITEMIZED")}
                    className="accent-primary"
                  />
                  Itemized
                </label>
              </div>
              <p className="text-xs text-fg-3">
                {kitPricingMode === "KIT_PRICE"
                  ? "One price for the whole kit."
                  : "Each item in the kit priced individually."}
              </p>
            </div>

            {kitPricingMode === "KIT_PRICE" && (
              <div className="space-y-2">
                <Label>Unit Price</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={kitUnitPrice}
                  onChange={(e) => setKitUnitPrice(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => addKitMut.mutate()}
              disabled={
                !selectedKitId ||
                addKitMut.isPending ||
                (kitAvailability && !kitAvailability.available)
              }
            >
              {addKitMut.isPending ? "Adding..." : "Add Kit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit group dialog */}
      <Dialog
        open={editGroupData != null}
        onOpenChange={(open) => {
          if (!open) setEditGroupData(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
            <DialogDescription>
              Update the group&apos;s title, description, and quantity.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={editGroupTitle}
                onChange={(e) => setEditGroupTitle(e.target.value)}
                placeholder="Group title"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editGroupDescription}
                onChange={(e) => setEditGroupDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="1"
                value={editGroupQuantity}
                onChange={(e) => setEditGroupQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Billing Override (leave blank to use project defaults)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Weeks</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editGroupBillingWeeks}
                    onChange={(e) => setEditGroupBillingWeeks(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Days</Label>
                  <Input
                    type="number"
                    min="0"
                    value={editGroupBillingDays}
                    onChange={(e) => setEditGroupBillingDays(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroupData(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editGroupData && editGroupTitle.trim()) {
                  updateGroupMut.mutate({
                    groupId: editGroupData.id,
                    data: {
                      title: editGroupTitle.trim(),
                      description: editGroupDescription.trim() || undefined,
                      quantity: parseInt(editGroupQuantity) || 1,
                      billingWeeks: editGroupBillingWeeks !== "" ? parseInt(editGroupBillingWeeks) : undefined,
                      billingDays: editGroupBillingDays !== "" ? parseInt(editGroupBillingDays) : undefined,
                    },
                  });
                }
              }}
              disabled={!editGroupTitle.trim() || updateGroupMut.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
