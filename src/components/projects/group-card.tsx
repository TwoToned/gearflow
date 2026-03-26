"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal } from "lucide-react";
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
  suggestedPrice: number | null;
  rentalPeriod: string | null;
  rentalQuantity: number | null;
  lineItemCount: number;
  children: React.ReactNode;
  onAcceptSuggested?: () => void;
  onEditPrice?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSaveAsTemplate?: () => void;
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
  onAcceptSuggested,
  onEditPrice,
  onEdit,
  onDelete,
  onSaveAsTemplate,
  dragHandleProps,
  defaultExpanded = false,
}: GroupCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const priceVal = price != null ? Number(price) : null;
  const suggestedVal = suggestedPrice != null ? Number(suggestedPrice) : null;
  const hasPriceDelta =
    priceVal != null && suggestedVal != null && suggestedVal > 0 && priceVal !== suggestedVal;

  const periodLabel = rentalPeriod === "WEEKLY" ? "week" : "day";
  const qtyLabel = rentalQuantity ? `${rentalQuantity} ${periodLabel}${rentalQuantity > 1 ? "s" : ""}` : null;

  return (
    <div className="rounded-lg bg-bg-surface ring-1 ring-foreground/8 transition-shadow hover:ring-foreground/12">
      {/* Collapsed header — always visible */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Drag handle */}
        {dragHandleProps && (
          <div
            className="flex-none cursor-grab text-fg-4 hover:text-fg-3 active:cursor-grabbing"
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
          {hasPriceDelta && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAcceptSuggested?.();
              }}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[oklch(0.45_0.12_195)] hover:bg-[oklch(0.96_0.02_195/10%)] transition-colors"
              title={`Accept suggested: ${formatCurrency(suggestedVal)}`}
            >
              {formatCurrency(suggestedVal)}
            </button>
          )}
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
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-7 w-7" />}>
              <MoreHorizontal className="h-3.5 w-3.5" />
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
        <div className="border-t border-foreground/5 px-3 pb-3 pt-2">
          {description && (
            <p className="mb-2 text-xs leading-relaxed text-fg-3">{description}</p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
