"use client";

import * as React from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Inline two-step confirm inside a DropdownMenu.
 *
 * First click renders the item in `confirmLabel` styling (destructive red).
 * Second click within `timeoutMs` (default 3000ms) fires `onConfirm`.
 * If the menu closes or the timeout lapses, it resets.
 *
 * Per DESIGN.md / Track-C plan: row-level / single-item destructive actions
 * use this pattern. Cascading deletes use a Dialog instead.
 */
interface ConfirmActionMenuItemProps
  extends Omit<
    React.ComponentProps<typeof DropdownMenuItem>,
    "onClick" | "onSelect" | "children" | "label"
  > {
  /** Idle-state label (e.g. "Delete asset"). */
  children: React.ReactNode;
  /** Confirm-state label (e.g. "Click again to confirm"). Defaults to "Click again to confirm". */
  confirmLabel?: React.ReactNode;
  /** Icon shown in idle state (Lucide icon component). */
  icon?: React.ReactNode;
  /** Fires when the user clicks the second (confirm) time. */
  onConfirm: () => void;
  /** Reset window in ms. Defaults to 3000. */
  timeoutMs?: number;
}

export function ConfirmActionMenuItem({
  children,
  confirmLabel = "Click again to confirm",
  icon,
  onConfirm,
  timeoutMs = 3000,
  className,
  ...props
}: ConfirmActionMenuItemProps) {
  const [armed, setArmed] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <DropdownMenuItem
      variant="destructive"
      onClick={(e) => {
        e.preventDefault();
        if (armed) {
          if (timerRef.current) clearTimeout(timerRef.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timerRef.current = setTimeout(() => setArmed(false), timeoutMs);
        }
      }}
      // Prevent base-ui from auto-closing on first click
      closeOnClick={false}
      className={cn(armed && "bg-destructive/10", className)}
      {...props}
    >
      {icon}
      {armed ? confirmLabel : children}
    </DropdownMenuItem>
  );
}
