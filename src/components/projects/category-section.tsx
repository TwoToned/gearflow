"use client";

import { useState, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";

interface TemplateOption {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

interface CategorySectionProps {
  id: string;
  name: string;
  groupCount: number;
  standaloneCount: number;
  categoryTotal: number;
  children: React.ReactNode;
  onAddGroup?: (title: string, templateId?: string) => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  defaultExpanded?: boolean;
  templates?: TemplateOption[];
}

export function CategorySection({
  name,
  groupCount,
  standaloneCount,
  categoryTotal,
  children,
  onAddGroup,
  onRename,
  onDelete,
  defaultExpanded = true,
  templates = [],
}: CategorySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const totalItems = groupCount + standaloneCount;

  function handleCreateGroup() {
    const trimmed = newGroupTitle.trim();
    if (!trimmed) return;
    onAddGroup?.(trimmed, selectedTemplateId || undefined);
    setNewGroupTitle("");
    setSelectedTemplateId("");
    setShowInlineForm(false);
  }

  return (
    <div className="space-y-1">
      {/* Category header — overline style per DESIGN.md SectionHeader */}
      <div className="group/cat flex items-center gap-2">
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
          {isRenaming ? (
            <Input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim()) {
                  onRename?.(renameValue.trim());
                  setIsRenaming(false);
                }
                if (e.key === "Escape") {
                  setIsRenaming(false);
                  setRenameValue(name);
                }
              }}
              onBlur={() => {
                if (renameValue.trim() && renameValue.trim() !== name) {
                  onRename?.(renameValue.trim());
                }
                setIsRenaming(false);
              }}
              className="h-5 w-40 border-0 bg-transparent px-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3 shadow-none focus-visible:ring-0"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3 group-hover:text-fg-2">
              {name}
            </span>
          )}
        </button>

        <span className="text-[10px] text-fg-4">
          {totalItems} item{totalItems !== 1 ? "s" : ""}
        </span>

        <div className="flex-1" />

        {/* Category actions menu */}
        {(onRename || onDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover/cat:opacity-100 transition-opacity">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Category</DropdownMenuLabel>
                {onRename && (
                  <DropdownMenuItem onClick={() => {
                    setRenameValue(name);
                    setIsRenaming(true);
                    setTimeout(() => renameRef.current?.focus(), 50);
                  }}>
                    Rename
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-[oklch(0.58_0.22_27)]"
                    >
                      Delete category
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Category total */}
        <span className="tabular-nums text-xs font-medium text-fg-2">
          {formatCurrency(categoryTotal)}
        </span>
      </div>

      {expanded && (
        <div className="space-y-0.5 pl-4">
          {children}

          {/* Inline group creation form */}
          {showInlineForm ? (
            <div className="space-y-1.5 py-1">
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
                    setSelectedTemplateId("");
                  }
                }}
                className="h-7 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                autoFocus
              />
              <div className="flex items-center gap-2">
                {templates.length > 0 && (
                  <Select value={selectedTemplateId} onValueChange={(v) => setSelectedTemplateId(v ?? "")}>
                    <SelectTrigger className="h-7 w-48 text-xs">
                      <SelectValue placeholder="From template...">
                        {selectedTemplateId
                          ? templates.find((t) => t.id === selectedTemplateId)?.name ?? "Template"
                          : "From template..."}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No template</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.itemCount} items)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-fg-4"
                  onClick={() => {
                    setShowInlineForm(false);
                    setNewGroupTitle("");
                    setSelectedTemplateId("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleCreateGroup}
                  disabled={!newGroupTitle.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowInlineForm(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="flex items-center gap-1 py-1 text-xs text-fg-4 transition-colors hover:text-fg-3"
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
