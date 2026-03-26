"use client";

import { useState, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";

interface CategorySectionProps {
  id: string;
  name: string;
  groupCount: number;
  standaloneCount: number;
  categoryTotal: number;
  children: React.ReactNode;
  onAddGroup?: (title: string) => void;
  onAcceptAllPrices?: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  defaultExpanded?: boolean;
}

export function CategorySection({
  name,
  groupCount,
  standaloneCount,
  categoryTotal,
  children,
  onAddGroup,
  onAcceptAllPrices,
  defaultExpanded = true,
}: CategorySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const totalItems = groupCount + standaloneCount;

  function handleCreateGroup() {
    const trimmed = newGroupTitle.trim();
    if (!trimmed) return;
    onAddGroup?.(trimmed);
    setNewGroupTitle("");
    setShowInlineForm(false);
  }

  return (
    <div className="space-y-2">
      {/* Category header — overline style per DESIGN.md SectionHeader */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 group"
        >
          <div className="text-fg-4 transition-colors group-hover:text-fg-3">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3 group-hover:text-fg-2">
            {name}
          </span>
        </button>

        <span className="text-[10px] text-fg-4">
          {totalItems} item{totalItems !== 1 ? "s" : ""}
        </span>

        <div className="flex-1" />

        {/* Batch accept suggested prices */}
        {onAcceptAllPrices && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-fg-3 hover:text-fg-2"
            onClick={onAcceptAllPrices}
          >
            <Check className="h-3 w-3" />
            Accept all prices
          </Button>
        )}

        {/* Category total */}
        <span className="tabular-nums text-xs font-medium text-fg-2">
          {formatCurrency(categoryTotal)}
        </span>
      </div>

      {expanded && (
        <div className="space-y-1.5 pl-5">
          {children}

          {/* Inline group creation form */}
          {showInlineForm ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-foreground/10 bg-bg-inset/50 px-3 py-2">
              <Input
                ref={inputRef}
                placeholder="Group title..."
                value={newGroupTitle}
                onChange={(e) => setNewGroupTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroup();
                  if (e.key === "Escape") {
                    setShowInlineForm(false);
                    setNewGroupTitle("");
                  }
                }}
                className="h-7 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                autoFocus
              />
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleCreateGroup}
                disabled={!newGroupTitle.trim()}
              >
                Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-fg-4"
                onClick={() => {
                  setShowInlineForm(false);
                  setNewGroupTitle("");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowInlineForm(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-lg border border-dashed border-foreground/8",
                "px-3 py-2 text-xs text-fg-4 transition-colors",
                "hover:border-foreground/15 hover:text-fg-3"
              )}
            >
              <Plus className="h-3 w-3" />
              Add group
            </button>
          )}
        </div>
      )}
    </div>
  );
}
