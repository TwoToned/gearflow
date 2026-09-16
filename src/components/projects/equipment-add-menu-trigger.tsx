"use client";

import { Plus, FolderPlus, FolderTree, ChevronDown as ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221) — the Equipment tab's
 * primary "Add ▾" menu (item / group / category), split out of
 * `equipment-tab.tsx` so it's independently testable (that 2,700+-line
 * component's own dependency graph makes a full mount in jsdom impractical —
 * see `__tests__/equipment-add-menu-trigger.smoke.test.tsx`'s file comment).
 *
 * Two render paths:
 * - `disabledReason` absent — the normal Radix `DropdownMenu` (item/group/
 *   category, unchanged from before this phase; adding is always structural,
 *   #1230, so it's never gated by the PRICING lock).
 * - `disabledReason` set (Phase 5, D15) — a plain `aria-disabled` button with
 *   its OWN `TooltipProvider` (CLAUDE.md: there is no global one) naming why
 *   and, implicitly via the strip above, the exit ("make it live"). Rendered
 *   as a disabled button + tooltip rather than a `GatedButton` nested inside
 *   `DropdownMenuTrigger asChild` — two layers of Radix `Slot` composing
 *   through each other is fragile; a plain conditional avoids it.
 */
export interface EquipmentAddMenuTriggerProps {
  disabledReason?: string;
  onAddItem: () => void;
  onAddGroup: () => void;
  onAddCategory: () => void;
}

export function EquipmentAddMenuTrigger({ disabledReason, onAddItem, onAddGroup, onAddCategory }: EquipmentAddMenuTriggerProps) {
  if (disabledReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="gap-1.5 opacity-45 cursor-not-allowed"
              aria-disabled="true"
              data-tour-anchor="tour-equipment-add"
              onClick={(e) => e.preventDefault()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
              <ChevronDownIcon className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>{disabledReason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5" data-tour-anchor="tour-equipment-add">
          <Plus className="h-3.5 w-3.5" />
          Add
          <ChevronDownIcon className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onAddItem}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add item
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddGroup}>
          <FolderPlus className="mr-2 h-3.5 w-3.5" />
          Add group
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddCategory}>
          <FolderTree className="mr-2 h-3.5 w-3.5" />
          Add category
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
