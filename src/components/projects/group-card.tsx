"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface GroupCardProps {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  price: number | null;
  suggestedPrice?: number | null;
  rentalPeriod: string | null;
  rentalQuantity: number | null;
  lineItemCount: number;
  children: React.ReactNode;
  onEditPrice?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSaveAsTemplate?: () => void;
  onAddEquipment?: () => void;
  onAddKit?: () => void;
  dragHandleProps?: Record<string, unknown>;
  defaultExpanded?: boolean;
}

export function GroupCard({
  title,
  description,
  quantity,
  price,
  suggestedPrice,
  rentalPeriod,
  rentalQuantity,
  lineItemCount,
  children,
  onEditPrice,
  onEdit,
  onDelete,
  onSaveAsTemplate,
  onAddEquipment,
  onAddKit,
  dragHandleProps,
  defaultExpanded = false,
}: GroupCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const priceVal = price != null ? Number(price) : null;

  const periodLabel = rentalPeriod === "WEEKLY" ? "week" : "day";
  const qtyLabel = rentalQuantity ? `${rentalQuantity} ${periodLabel}${rentalQuantity > 1 ? "s" : ""}` : null;

  return (
    <div className="group/card">
      {/* Collapsed header — always visible */}
      <div
        className="flex items-center gap-2 py-1 cursor-pointer select-none rounded px-1 -mx-1 hover:bg-bg-inset/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Drag handle — visible on hover only */}
        {dragHandleProps && (
          <div
            className="flex-none cursor-grab text-fg-4 opacity-0 transition-opacity group-hover/card:opacity-100 hover:text-fg-3 active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        {/* Chevron */}
        <div className="flex-none text-fg-4">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </div>

        {/* Title + metadata */}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-fg">{title}</span>
          {quantity > 1 && (
            <span className="flex-none text-xs text-fg-4">×{quantity}</span>
          )}
          <span className="flex-none text-xs text-fg-4">
            {lineItemCount} item{lineItemCount !== 1 ? "s" : ""}
          </span>
          {qtyLabel && (
            <span className="flex-none text-xs text-fg-4">{qtyLabel}</span>
          )}
        </div>

        {/* Price area */}
        <div className="flex flex-none items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditPrice?.();
            }}
            className={cn(
              "tabular-nums text-sm font-semibold transition-colors",
              priceVal != null
                ? "text-fg hover:text-[oklch(0.45_0.12_195)]"
                : "text-fg-4 hover:text-fg-3"
            )}
          >
            {priceVal != null ? formatCurrency(priceVal) : "Set price"}
          </button>

          {/* Actions menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Group</DropdownMenuLabel>
                <DropdownMenuItem onClick={onEdit}>Edit details</DropdownMenuItem>
                <DropdownMenuItem onClick={onSaveAsTemplate}>Save as template</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-[oklch(0.58_0.22_27)]"
                >
                  Delete group
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="pl-6 pb-1 pt-0.5">
          {description && (
            <p className="mb-1 line-clamp-1 text-xs leading-relaxed text-fg-4">{description}</p>
          )}

          {children}

          {/* Add items buttons */}
          {onAddEquipment && (
            <div className="mt-1 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddEquipment();
                  }}
                  className="flex items-center gap-1 text-xs text-fg-4 hover:text-fg-3 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Equipment
                </button>
                {onAddKit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddKit();
                    }}
                    className="flex items-center gap-1 text-xs text-fg-4 hover:text-fg-3 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    Kit
                  </button>
                )}

              </div>
              {onSaveAsTemplate && lineItemCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSaveAsTemplate();
                  }}
                  className="text-xs text-fg-4 hover:text-fg-3 transition-colors"
                >
                  Save as template
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
