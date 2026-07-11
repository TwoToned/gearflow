"use client";

/**
 * Shared Category + Group placement picker for the unified "Add …" forms
 * (own-stock / kit / custom). Before this, each form rendered placement
 * differently — own-stock had Category only, kit had none, custom had both —
 * so the "add" screens showed different boxes. This is the single source of
 * truth for that box so all three match.
 *
 * Registry `Select` with explicit `SelectValue` children and the `"__none__"`
 * sentinel (Radix forbids empty-string `SelectItem` values). Changing the
 * category clears the group (the group list is scoped to the category).
 */

import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { CategoryData } from "./equipment-rows";

export function PlacementFields({
  categories,
  categoryId,
  groupId,
  onChange,
}: {
  categories: CategoryData[];
  categoryId: string;
  groupId: string;
  /** Fires with the next placement. Changing the category clears the group. */
  onChange: (next: { categoryId: string; groupId: string }) => void;
}) {
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const groupOptions = selectedCategory?.groups ?? [];

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select
          value={categoryId || "__none__"}
          onValueChange={(val) => onChange({ categoryId: val === "__none__" ? "" : val, groupId: "" })}
        >
          <SelectTrigger>
            <SelectValue>{selectedCategory?.name ?? "Uncategorized"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Uncategorized</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Group</Label>
        <Select
          value={groupId || "__none__"}
          onValueChange={(val) => onChange({ categoryId, groupId: val === "__none__" ? "" : val })}
          disabled={!categoryId}
        >
          <SelectTrigger>
            <SelectValue>
              {groupOptions.find((g) => g.id === groupId)?.title ?? "No group"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No group</SelectItem>
            {groupOptions.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
