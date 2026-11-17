"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Sheet, SheetOverlay, SheetPortal } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The ONE phone bottom sheet (UX unification §5.2; shared by ActionMenu,
 * AddBar and RowEditorSheet — R-3.3). Built on the Radix `Sheet` (a Dialog),
 * never vaul. Items are 48 px and close the sheet on tap; the bottom padding
 * is a safe-area inset applied inline (`env()` is not a Tailwind value).
 */
const CloseContext = React.createContext<() => void>(() => {});

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible heading, or screen-reader-only context for the sheet. */
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto overscroll-contain",
            "rounded-t-[var(--radius)] border-2 border-b-0 border-border bg-elev text-ink shadow-[var(--sh-card),var(--lit)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            className,
          )}
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
        >
          <div aria-hidden="true" data-slot="grab-handle" className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-border" />
          <DialogPrimitive.Title className="px-4 pb-1 pt-1 text-[13px] font-semibold text-muted">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="px-4 pb-1 text-[12px] text-muted">
              {description}
            </DialogPrimitive.Description>
          )}
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </DialogPrimitive.Content>
      </SheetPortal>
    </Sheet>
  );
}

/** A 48 px row. Closes the sheet after `onSelect` unless `keepOpen` (sub-levels). */
export function BottomSheetItem({
  onSelect,
  keepOpen = false,
  danger = false,
  icon,
  trailing,
  children,
  className,
}: {
  onSelect: () => void;
  keepOpen?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const close = React.useContext(CloseContext);
  return (
    <button
      type="button"
      onClick={() => {
        if (!keepOpen) close();
        onSelect();
      }}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] outline-none",
        "active:bg-paper-2 focus-visible:bg-paper-2",
        danger && "text-t-out",
        className,
      )}
    >
      {icon && <span className="grid size-5 shrink-0 place-items-center [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}

export function BottomSheetSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />;
}
