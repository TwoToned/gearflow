"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Container, Check, Loader2 } from "lucide-react";
import { getProjectPullSheet } from "@/server/warehouse";
import { Checkbox } from "@/components/ui/checkbox";
import { useActiveOrganization } from "@/lib/auth-client";

function getStorageKey(projectId: string) {
  return `picklist-checks-${projectId}`;
}

function loadChecked(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveChecked(projectId: string, checked: Set<string>) {
  try {
    localStorage.setItem(getStorageKey(projectId), JSON.stringify([...checked]));
  } catch { /* ignore */ }
}

/**
 * Accessories permanently attached to an asset (childKind === "ACCESSORY")
 * travel with their parent line. Unlike kit members they hang off a normal
 * top-level asset row, so we render them indented underneath it.
 */
function getAccessoryChildren(item: Record<string, unknown>): Array<Record<string, unknown>> {
  const children = (item.childLineItems || []) as Array<Record<string, unknown>>;
  return children.filter((c) => c.childKind === "ACCESSORY");
}

interface OnlinePickListProps {
  projectId: string;
}

export function OnlinePickList({ projectId }: OnlinePickListProps) {
  const [checked, setChecked] = useState<Set<string>>(() => loadChecked(projectId));
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["warehouse-pullsheet", orgId, projectId],
    queryFn: () => getProjectPullSheet(projectId),
  });

  useEffect(() => {
    saveChecked(projectId, checked);
  }, [checked, projectId]);

  // Get all child checkbox keys for a kit item
  const getKitChildKeys = useCallback((item: Record<string, unknown>): string[] => {
    const children = (item.childLineItems || []) as Array<Record<string, unknown>>;
    const keys: string[] = [];
    for (const child of children) {
      const childQty = child.quantity as number;
      if (childQty > 1) {
        for (let i = 0; i < childQty; i++) keys.push(`${child.id}-${i}`);
      } else {
        keys.push(child.id as string);
      }
    }
    return keys;
  }, []);

  const toggle = useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Toggle kit header: check/uncheck all children + header together
  const toggleKit = useCallback((item: Record<string, unknown>) => {
    const kitKey = `kit-${item.id}`;
    const childKeys = getKitChildKeys(item);
    setChecked((prev) => {
      const next = new Set(prev);
      const allChecked = next.has(kitKey) && childKeys.every((k) => next.has(k));
      if (allChecked) {
        next.delete(kitKey);
        for (const k of childKeys) next.delete(k);
      } else {
        next.add(kitKey);
        for (const k of childKeys) next.add(k);
      }
      return next;
    });
  }, [getKitChildKeys]);

  // Toggle a kit child: also sync the kit header checkbox
  const toggleKitChild = useCallback((key: string, item: Record<string, unknown>) => {
    const kitKey = `kit-${item.id}`;
    const childKeys = getKitChildKeys(item);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Auto-check kit header if all children are now checked
      const allChildrenChecked = childKeys.every((k) => next.has(k));
      if (allChildrenChecked) next.add(kitKey);
      else next.delete(kitKey);
      return next;
    });
  }, [getKitChildKeys]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-fg-3">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading pick list...
      </div>
    );
  }

  if (!data) return null;

  const groups = data.groups as Record<string, Array<Record<string, unknown>>>;
  const allGroups = Object.entries(groups).map(([name, items]) => ({ name, items }));

  // Count totals for progress
  let totalItems = 0;
  let checkedItems = 0;
  const countRows = (id: string, quantity: number) => {
    if (quantity > 1) {
      for (let i = 0; i < quantity; i++) {
        totalItems++;
        if (checked.has(`${id}-${i}`)) checkedItems++;
      }
    } else {
      totalItems++;
      if (checked.has(id)) checkedItems++;
    }
  };
  for (const group of allGroups) {
    for (const item of group.items) {
      const isKit = !!(item.kitId) && !(item.isKitChild);
      const isGroup = isKit;
      const qty = item.quantity as number;
      const children = isGroup ? ((item.childLineItems || []) as Array<Record<string, unknown>>) : [];

      if (isGroup) {
        // Kit header itself
        totalItems++;
        if (checked.has(`kit-${item.id}`)) checkedItems++;
        for (const child of children) {
          countRows(child.id as string, child.quantity as number);
        }
      } else {
        countRows(item.id as string, qty);
        // Accessories that travel with this asset are pickable in their own right
        for (const child of getAccessoryChildren(item)) {
          countRows(child.id as string, child.quantity as number);
        }
      }
    }
  }

  const progress = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-bg-inset overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-fg-3 shrink-0">
          {checkedItems}/{totalItems}
        </span>
        {progress === 100 && (
          <Check className="h-4 w-4 text-green-500 shrink-0" />
        )}
      </div>

      {allGroups.length === 0 ? (
        <p className="text-fg-3 text-center py-8">
          No equipment items on this project.
        </p>
      ) : (
        allGroups.map((group) => (
          <div key={group.name}>
            <h3 className="text-xs font-semibold text-fg-3 uppercase tracking-wider mb-2">
              {group.name}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const model = item.model as { name: string; modelNumber?: string | null } | null;
                const asset = item.asset as { assetTag: string; location?: { name: string } | null } | null;
                const bulkAsset = item.bulkAsset as { assetTag: string } | null;
                const kit = item.kit as { assetTag: string; name: string } | null;
                const assetTag = asset?.assetTag || bulkAsset?.assetTag || null;
                const isKit = !!(item.kitId) && !(item.isKitChild);
                const isGroup = isKit;
                const children = isGroup ? ((item.childLineItems || []) as Array<Record<string, unknown>>) : [];
                const qty = item.quantity as number;
                const itemName = isKit
                  ? (item.description as string) || kit?.name || "Kit"
                  : model
                      ? [model.name, model.modelNumber].filter(Boolean).join(" - ")
                      : (item.description as string) || "Unnamed item";

                return (
                  <React.Fragment key={item.id as string}>
                    {/* Kit group header */}
                    {isGroup && (() => {
                      const groupKey = `kit-${item.id}`;
                      const groupChecked = checked.has(groupKey);
                      return (
                        <button
                          onClick={() => toggleKit(item)}
                          className={`flex w-full items-center gap-2 rounded-md bg-bg-inset/50 px-3 py-2.5 mt-2 text-left transition-colors hover:bg-accent/50 active:bg-accent ${
                            groupChecked ? "opacity-60" : ""
                          }`}
                        >
                          <Checkbox checked={groupChecked} className="shrink-0 pointer-events-none" />
                          <Container className="h-4 w-4 text-fg-3 shrink-0" />
                          <span className={`font-semibold text-sm flex-1 ${groupChecked ? "line-through text-fg-3" : ""}`}>{itemName}</span>
                          {isKit && <span className="font-mono text-xs text-fg-3">{kit?.assetTag}</span>}
                        </button>
                      );
                    })()}

                    {/* Group children */}
                    {isGroup && children.map((child) => {
                      const childModel = child.model as { name: string; modelNumber?: string | null } | null;
                      const childAsset = child.asset as { assetTag: string } | null;
                      const childBulk = child.bulkAsset as { assetTag: string } | null;
                      const childName = childModel?.name || (child.description as string) || "-";
                      const childTag = childAsset?.assetTag || childBulk?.assetTag || null;
                      const childQty = child.quantity as number;

                      if (childQty > 1) {
                        return Array.from({ length: childQty }).map((_, i) => {
                          const key = `${child.id}-${i}`;
                          const isChecked = checked.has(key);
                          return (
                            <PickListRow
                              key={key}
                              label={`${childName} - ${i + 1}`}
                              tag={childTag}
                              checked={isChecked}
                              onToggle={() => toggleKitChild(key, item)}
                              indent={2}
                            />
                          );
                        });
                      }

                      const isChecked = checked.has(child.id as string);
                      return (
                        <PickListRow
                          key={child.id as string}
                          label={childName}
                          tag={childTag}
                          checked={isChecked}
                          onToggle={() => toggleKitChild(child.id as string, item)}
                          indent={2}
                        />
                      );
                    })}

                    {/* Non-group items */}
                    {!isGroup && qty > 1 && Array.from({ length: qty }).map((_, i) => {
                      const key = `${item.id}-${i}`;
                      const isChecked = checked.has(key);
                      return (
                        <PickListRow
                          key={key}
                          label={`${itemName} - ${i + 1}`}
                          tag={assetTag}
                          checked={isChecked}
                          onToggle={() => toggle(key)}
                        />
                      );
                    })}

                    {!isGroup && qty <= 1 && (
                      <PickListRow
                        key={item.id as string}
                        label={itemName}
                        tag={assetTag}
                        location={asset?.location?.name}
                        checked={checked.has(item.id as string)}
                        onToggle={() => toggle(item.id as string)}
                      />
                    )}

                    {/* Accessories attached to this asset — picked alongside it */}
                    {!isGroup && getAccessoryChildren(item).map((child) => {
                      const childModel = child.model as { name: string; modelNumber?: string | null } | null;
                      const childAsset = child.asset as { assetTag: string } | null;
                      const childBulk = child.bulkAsset as { assetTag: string } | null;
                      const childName = childModel?.name || (child.description as string) || "-";
                      const childTag = childAsset?.assetTag || childBulk?.assetTag || null;
                      const childQty = child.quantity as number;

                      if (childQty > 1) {
                        return Array.from({ length: childQty }).map((_, i) => {
                          const key = `${child.id}-${i}`;
                          return (
                            <PickListRow
                              key={key}
                              label={childQty > 1 ? `${childName} - ${i + 1}` : childName}
                              tag={childTag}
                              accessory
                              checked={checked.has(key)}
                              onToggle={() => toggle(key)}
                              indent={1}
                            />
                          );
                        });
                      }

                      return (
                        <PickListRow
                          key={child.id as string}
                          label={childName}
                          tag={childTag}
                          accessory
                          checked={checked.has(child.id as string)}
                          onToggle={() => toggle(child.id as string)}
                          indent={1}
                        />
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Clear all button */}
      {checkedItems > 0 && (
        <button
          onClick={() => setChecked(new Set())}
          className="text-xs text-fg-3 hover:text-fg transition-colors"
        >
          Clear all checks
        </button>
      )}
    </div>
  );
}

function PickListRow({
  label,
  tag,
  location,
  checked,
  onToggle,
  indent = 0,
  accessory = false,
}: {
  label: string;
  tag?: string | null;
  location?: string | null;
  checked: boolean;
  onToggle: () => void;
  indent?: number;
  accessory?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent/50 active:bg-accent ${
        checked ? "opacity-60" : ""
      }`}
      style={indent ? { paddingLeft: `${indent * 1.25 + 0.75}rem` } : undefined}
    >
      <Checkbox checked={checked} className="shrink-0 pointer-events-none" />
      <span className={`flex-1 text-sm ${checked ? "line-through text-fg-3" : accessory ? "" : "font-medium"}`}>
        {label}
      </span>
      {accessory && (
        <span className="rounded bg-bg-inset px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-3 shrink-0">
          Accessory
        </span>
      )}
      {tag && (
        <span className="font-mono text-xs text-fg-3 shrink-0">{tag}</span>
      )}
      {location && !tag && (
        <span className="text-xs text-fg-3 shrink-0">{location}</span>
      )}
    </button>
  );
}
