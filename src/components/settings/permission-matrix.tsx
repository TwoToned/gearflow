"use client";

import { PERMISSION_REGISTRY, RESOURCES, type PermissionMap } from "@/lib/permissions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface PermissionMatrixProps {
  permissions: PermissionMap;
  onChange: (permissions: PermissionMap) => void;
  disabled?: boolean;
}

export function PermissionMatrix({
  permissions,
  onChange,
  disabled = false,
}: PermissionMatrixProps) {
  // Collect all unique action keys across all resources
  const allActions: { key: string; label: string }[] = [];
  const seenActions = new Set<string>();
  for (const resource of RESOURCES) {
    for (const action of PERMISSION_REGISTRY[resource].actions) {
      if (!seenActions.has(action.key)) {
        seenActions.add(action.key);
        allActions.push(action);
      }
    }
  }

  const isChecked = (resource: string, action: string) => {
    const res = resource as keyof PermissionMap;
    return permissions[res]?.includes(action) ?? false;
  };

  const toggle = (resource: string, action: string) => {
    const res = resource as keyof PermissionMap;
    const current = [...(permissions[res] ?? [])];
    const idx = current.indexOf(action);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(action);
    }
    onChange({ ...permissions, [res]: current });
  };

  const toggleRow = (resource: string) => {
    const reg = PERMISSION_REGISTRY[resource as keyof typeof PERMISSION_REGISTRY];
    const current = permissions[resource as keyof PermissionMap] ?? [];
    const allChecked = reg.actions.every((a) => current.includes(a.key));
    onChange({
      ...permissions,
      [resource]: allChecked ? [] : reg.actions.map((a) => a.key),
    });
  };

  const selectAll = () => {
    const full: PermissionMap = {};
    for (const r of RESOURCES) {
      full[r] = PERMISSION_REGISTRY[r].actions.map((a) => a.key);
    }
    onChange(full);
  };

  const clearAll = () => {
    const empty: PermissionMap = {};
    for (const r of RESOURCES) {
      empty[r] = [];
    }
    onChange(empty);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" variant="line" size="sm" onClick={selectAll} disabled={disabled}>
          Select All
        </Button>
        <Button type="button" variant="line" size="sm" onClick={clearAll} disabled={disabled}>
          Clear All
        </Button>
      </div>

      <div className="space-y-3">
        {RESOURCES.map((resource) => {
          const reg = PERMISSION_REGISTRY[resource];
          const current = permissions[resource] ?? [];
          const allRowChecked = reg.actions.every((a) => current.includes(a.key));

          return (
            <div key={resource} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{reg.label}</span>
                <label className="flex items-center gap-1.5 text-xs text-fg-3 cursor-pointer">
                  All
                  <Checkbox
                    checked={allRowChecked}
                    onCheckedChange={() => toggleRow(resource)}
                    disabled={disabled}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {reg.actions.map((action) => (
                  <label key={action.key} className="flex items-center gap-1.5 text-sm cursor-pointer min-w-[5rem]">
                    <Checkbox
                      checked={isChecked(resource, action.key)}
                      onCheckedChange={() => toggle(resource, action.key)}
                      disabled={disabled}
                    />
                    {action.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
