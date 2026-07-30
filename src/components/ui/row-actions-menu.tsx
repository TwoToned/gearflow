"use client";

import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface RowAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
  loading?: boolean;
}

/**
 * A row's secondary actions collapsed behind one "..." trigger instead of a
 * wall of pill buttons — the list-row pattern reference apps (Wave, Square,
 * Jobber invoice/quote lists) use once a row has more than one or two
 * actions. Keeps every row to a fixed, small button count regardless of how
 * many state-dependent actions apply, so it never wraps into multiple lines
 * on mobile. Renders nothing when there's nothing to show — callers should
 * build `actions` from already permission-filtered entries (only include an
 * action the caller has confirmed the user may take).
 */
export function RowActionsMenu({ actions, label = "More actions" }: { actions: RowAction[]; label?: string }) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="line" size="icon" className="touch-target size-8" aria-label={label}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            disabled={action.loading}
            onClick={action.onClick}
            className={action.destructive ? "text-destructive focus:text-destructive" : undefined}
          >
            <action.icon className="h-3.5 w-3.5" /> {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
