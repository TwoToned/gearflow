"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** What the ticked lines look like to the Prep button (§9.5). */
export interface PrepSelectionInfo {
  /** Ticked lines. */
  count: number;
  /** Units of the parents still to pick. */
  parentUnits: number;
  /** Ticked parents already packed (only their accessories are left). */
  packedParents: number;
  /** Accessory lines still to pack across the selection. */
  accessoryLines: number;
}

export interface PrepHandlers {
  withAccessories: () => void;
  parentOnly: () => void;
  accessoriesWithParent: () => void;
  accessoriesIntoActive: () => void;
  choose: () => void;
  unpackParent: () => void;
}

export interface PrepMenu {
  primary: { label: string; run: () => void; disabled: boolean };
  items: Array<{ key: string; label: string; run: () => void }>;
}

/** One `Prep ▾`, context-aware (spec §9.5). Pure so the label table is testable. */
export function prepMenuFor(sel: PrepSelectionInfo, h: PrepHandlers): PrepMenu {
  const acc = sel.accessoryLines;
  if (sel.count === 0) return { primary: { label: "Prep", run: () => {}, disabled: true }, items: [] };
  if (sel.parentUnits > 0) {
    return {
      primary: { label: acc ? `Prep ${sel.parentUnits} + accessories` : `Prep ${sel.parentUnits}`, run: h.withAccessories, disabled: false },
      items: [
        ...(acc ? [{ key: "parent-only", label: "Parent only · accessories stay to pick", run: h.parentOnly }] : []),
        { key: "choose", label: "Choose which…", run: h.choose },
      ],
    };
  }
  return {
    primary: { label: `Pack ${acc} accessor${acc === 1 ? "y" : "ies"}`, run: h.accessoriesWithParent, disabled: acc === 0 },
    items: [
      { key: "with-parent", label: "Pack accessories with the parent", run: h.accessoriesWithParent },
      { key: "into-active", label: "Pack accessories into the active case", run: h.accessoriesIntoActive },
      { key: "choose", label: "Choose which…", run: h.choose },
      { key: "unpack", label: "Unpack parent", run: h.unpackParent },
    ],
  };
}

/** The ONE Prep control: split button, label follows the selection (replaces the three live buttons). */
export function PrepSplitButton({ selection, handlers }: { selection: PrepSelectionInfo; handlers: PrepHandlers }) {
  const menu = prepMenuFor(selection, handlers);
  return (
    <div className="inline-flex items-stretch">
      <Button className="rounded-r-none" disabled={menu.primary.disabled} onClick={menu.primary.run}>
        {menu.primary.label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Prep options" className="rounded-l-none border-l border-white/20 px-2" disabled={menu.items.length === 0}>
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {menu.items.map((i) => (
            <DropdownMenuItem key={i.key} onSelect={i.run}>
              {i.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
