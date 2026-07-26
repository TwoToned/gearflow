"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { Container, Check } from "lucide-react";
import { getProjectPullSheet } from "@/server/warehouse";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { focusRing } from "@/lib/utils";
import { pickListProgress, getAccessoryChildren } from "./pick-list-progress";

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

interface OnlinePickListProps {
  projectId: string;
}

export function OnlinePickList({ projectId }: OnlinePickListProps) {
  const [checked, setChecked] = useState<Set<string>>(() => loadChecked(projectId));
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useServerQuery({
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
      <div className="space-y-2 py-2" aria-busy="true">
        <Skeleton className="h-2 rounded-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-[var(--r)]" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const groups = data.groups as Record<string, Array<Record<string, unknown>>>;
  const allGroups = Object.entries(groups).map(([name, items]) => ({ name, items }));

  // Count totals for progress
  const { totalItems, checkedItems } = pickListProgress(allGroups, checked);
  const progress = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-paper-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-red transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-ui-text text-muted shrink-0 tabular-nums">
          {checkedItems}/{totalItems}
        </span>
        {progress === 100 && (
          <Check className="h-4 w-4 text-ok shrink-0" />
        )}
      </div>

      {allGroups.length === 0 ? (
        <p className="text-muted text-center py-8">
          No equipment items on this project.
        </p>
      ) : (
        allGroups.map((group) => (
          <div key={group.name}>
            <h3 className="t-overline text-muted mb-2">
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
                // A non-kit top-level line with ACCESSORY children (issue #794) —
                // its accessories are independently pickable rows, indented below it
                // (not synced to the parent like a kit member; pickListProgress
                // already counts them this way, this closes the render-side gap).
                const accessoryChildren = isGroup ? [] : getAccessoryChildren(item);
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
                          aria-pressed={groupChecked}
                          className={`flex min-h-11 w-full items-center gap-2 rounded-[var(--r)] bg-paper-2/60 px-3 py-2.5 mt-2 text-left transition-colors hover:bg-elev active:bg-elev ${focusRing} ${
                            groupChecked ? "opacity-60" : ""
                          }`}
                        >
                          <Checkbox checked={groupChecked} className="shrink-0 pointer-events-none" />
                          <Container className="h-4 w-4 text-muted shrink-0" />
                          <span className={`font-semibold text-ui-text flex-1 ${groupChecked ? "line-through text-muted" : "text-ink"}`}>{itemName}</span>
                          {isKit && <span className="t-mono text-muted">{kit?.assetTag}</span>}
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

                    {/* Accessory children — independently pickable, indented */}
                    {accessoryChildren.map((child) => {
                      const childModel = child.model as { name: string; modelNumber?: string | null } | null;
                      const childAsset = child.asset as { assetTag: string } | null;
                      const childBulk = child.bulkAsset as { assetTag: string } | null;
                      const childName = childModel?.name || (child.description as string) || "Accessory";
                      const childTag = childAsset?.assetTag || childBulk?.assetTag || null;
                      const childQty = child.quantity as number;

                      if (childQty > 1) {
                        return Array.from({ length: childQty }).map((_, i) => {
                          const key = `${child.id}-${i}`;
                          return (
                            <PickListRow
                              key={key}
                              label={`${childName} - ${i + 1}`}
                              tag={childTag}
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
          className={`inline-flex min-h-11 items-center rounded-[var(--r)] px-3 text-caption text-muted transition-colors hover:text-ink ${focusRing}`}
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
}: {
  label: string;
  tag?: string | null;
  location?: string | null;
  checked: boolean;
  onToggle: () => void;
  indent?: number;
}) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={checked}
      className={`flex min-h-11 w-full items-center gap-3 rounded-[var(--r)] px-3 py-2.5 text-left transition-colors hover:bg-elev active:bg-elev ${focusRing} ${
        checked ? "opacity-60" : ""
      }`}
      style={indent ? { paddingLeft: `${indent * 1.25 + 0.75}rem` } : undefined}
    >
      <Checkbox checked={checked} className="shrink-0 pointer-events-none" />
      <span className={`flex-1 text-ui-text ${checked ? "line-through text-muted" : "font-medium text-ink"}`}>
        {label}
      </span>
      {tag && (
        <span className="t-mono text-muted shrink-0">{tag}</span>
      )}
      {location && !tag && (
        <span className="text-caption text-muted shrink-0">{location}</span>
      )}
    </button>
  );
}
