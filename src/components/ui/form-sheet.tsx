"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * `FormSheet` (UX unification §9l.3, D62): the ONE shell every `/new` and
 * `/[id]/edit` form renders in. Centred and wide on desktop, a full-height
 * bottom sheet on phone. It owns the chrome only: the title, a scrolling body
 * (the caller's fields), a sticky footer, and the dirty-close confirm. It owns
 * no fields, no schema and no persistence: `onSubmit` is the caller's ONE save.
 *
 * - Footer: Cancel and the primary; `addAnother` is an OPTIONAL slot for
 *   batched forms (asset, crew, location) and renders as a word line, above
 *   the buttons on a phone.
 * - Closing (Esc, the overlay, ✕, Cancel) while `dirty` asks `Discard your
 *   changes?` first. `Keep editing` returns to the form with the draft intact.
 * - Phone: inputs are 16 px (iOS does not zoom), 44 px targets, the footer is
 *   pinned with a safe-area inset applied inline (`env()` is not a Tailwind
 *   value) and the body scrolls under it.
 * - Pickers inside must be Radix (`combobox-picker.tsx`): a Base UI popup
 *   inside this Radix Dialog is click-locked (CLAUDE.md).
 */
export interface FormSheetAddAnother {
  /** e.g. `Save and add another`. */
  label: string;
  /** Saves, then the caller resets what it wants kept or cleared. */
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
}

export interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Muted hint line under the title. */
  description?: string;
  /** The fields. Wrapped in a `<form>`, so Enter in an input submits. */
  children: React.ReactNode;
  /** The primary button's text, e.g. `Create asset`. */
  primaryLabel: string;
  /** The ONE save. Called by the primary and by Enter. */
  onSubmit: () => void | Promise<void>;
  submitting?: boolean;
  primaryDisabled?: boolean;
  /** Unsaved changes: closing asks first. */
  dirty?: boolean;
  addAnother?: FormSheetAddAnother;
  /** Left of the footer buttons on desktop, above them on phone (e.g. `Import CSV…`). */
  footerStart?: React.ReactNode;
  /** `wide` (default) suits a record; `narrow` a five-field form. */
  size?: "wide" | "narrow";
}

/** Every close path (Esc, overlay, ✕, Cancel) goes through `requestClose`. */
function useDirtyClose(dirty: boolean, onOpenChange: (open: boolean) => void) {
  const [confirming, setConfirming] = React.useState(false);
  const requestClose = React.useCallback(() => {
    if (dirty) setConfirming(true);
    else onOpenChange(false);
  }, [dirty, onOpenChange]);
  const discard = () => {
    setConfirming(false);
    onOpenChange(false);
  };
  return { confirming, setConfirming, requestClose, discard };
}

function contentClass(isMobile: boolean, size: "wide" | "narrow") {
  return cn(
    "fixed z-50 flex flex-col overflow-hidden bg-elev text-ink shadow-[var(--sh-card),var(--lit)]",
    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    isMobile
      ? "inset-x-0 bottom-0 h-[100dvh] rounded-t-[var(--radius)] border-2 border-b-0 border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom [&_input]:text-base [&_textarea]:text-base"
      : cn(
          "left-1/2 top-1/2 max-h-[calc(100dvh-4rem)] w-full -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius)] border-2 border-border",
          size === "wide" ? "max-w-3xl" : "max-w-lg",
        ),
  );
}

function SheetHeader({ title, description, onClose }: { title: string; description?: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-card-title font-bold text-ink">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-0.5 text-caption text-muted">{description}</DialogPrimitive.Description>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-paper-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
      >
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </button>
    </div>
  );
}

type FooterProps = Pick<
  FormSheetProps,
  "primaryLabel" | "submitting" | "primaryDisabled" | "addAnother" | "footerStart"
> & { onCancel: () => void };

function SheetFooter({ primaryLabel, submitting, primaryDisabled, addAnother, footerStart, onCancel }: FooterProps) {
  return (
    <div
      data-slot="form-sheet-footer"
      className="flex flex-col gap-2 border-t border-line bg-elev px-5 pt-3 sm:flex-row sm:items-center"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div className="sm:mr-auto">{footerStart}</div>
      {addAnother ? (
        <button
          type="button"
          disabled={submitting || addAnother.disabled}
          onClick={() => void addAnother.onSelect()}
          className="min-h-11 text-left text-table-cell text-ink-2 underline-offset-4 hover:underline disabled:opacity-45 sm:text-center"
        >
          {addAnother.label}
        </button>
      ) : null}
      <div className="flex gap-2 sm:justify-end">
        <Button type="button" variant="line" className="min-h-11 flex-1 sm:flex-none" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11 flex-1 sm:flex-none" loading={submitting} disabled={primaryDisabled}>
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}

function DiscardDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onKeep()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Discard your changes?</DialogTitle>
          <DialogDescription>What you changed in this form has not been saved.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={onKeep}>
            Keep editing
          </Button>
          <Button type="button" onClick={onDiscard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  dirty = false,
  size = "wide",
  ...footer
}: FormSheetProps) {
  const isMobile = useIsMobile();
  const { confirming, setConfirming, requestClose, discard } = useDirtyClose(dirty, onOpenChange);
  const blocked = footer.submitting || footer.primaryDisabled;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            {...(description ? {} : { "aria-describedby": undefined })}
            data-slot="form-sheet"
            data-variant={isMobile ? "phone" : "desktop"}
            className={contentClass(isMobile, size)}
          >
            <form
              noValidate
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                if (!blocked) void onSubmit();
              }}
            >
              <SheetHeader title={title} description={description} onClose={requestClose} />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
              <SheetFooter {...footer} onCancel={requestClose} />
            </form>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
      <DiscardDialog open={confirming} onKeep={() => setConfirming(false)} onDiscard={discard} />
    </>
  );
}
