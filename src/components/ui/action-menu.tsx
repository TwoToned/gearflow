"use client";

import * as React from "react";
import { MoreHorizontal, ChevronRight, ChevronLeft } from "lucide-react";

import { BottomSheet, BottomSheetItem, BottomSheetSeparator } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import { groupActionItems, itemForShortcut } from "@/lib/row-actions/group-items";
import { cn } from "@/lib/utils";

/**
 * The one row menu (UX unification §5.2). Renders an `ActionMenuSpec` as a
 * Radix DropdownMenu on desktop and as a 48 px-item bottom sheet on phone.
 * The spec is built by a per-kind builder in `src/lib/row-actions/`; an action
 * that does not apply is ABSENT from it, never disabled. A `danger` item with
 * a `confirm` opens a `Dialog` (there is no AlertDialog) and only runs on its
 * confirm button. One sub-level. Single-key shortcuts (E/M/D) fire while the
 * desktop menu is open.
 *
 * The trigger is always rendered (D39): muted on desktop, brightened on hover
 * or focus, and 40 px on phone.
 */
export function ActionMenu({
  spec,
  label = "More actions",
  className,
  triggerClassName,
  trigger: customTrigger,
  header,
}: {
  spec: ActionMenuSpec;
  label?: string;
  /** Replaces the default ⋯ button (e.g. `Documents ▾`, a lock glyph). One
   *  element: composed with Radix `asChild` on desktop; on phone the same
   *  element opens the bottom sheet. */
  trigger?: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
  /** Non-interactive block at the top of the menu (desktop and phone sheet), e.g.
   *  the lock glyph's who / when / what is read-only sentence (§6b). */
  header?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<ActionItem | null>(null);

  if (spec.items.length === 0) return null;

  const run = (item: ActionItem) => {
    setOpen(false);
    if (item.confirm) setPending(item);
    else void item.onSelect();
  };

  const trigger = customTrigger ? (
    isMobile ? phoneTrigger({ element: customTrigger, onOpen: () => setOpen(true) }) : customTrigger
  ) : (
    defaultTrigger({ isMobile, onOpen: () => setOpen(true), className: triggerClassName, label })
  );

  return (
    <span className={className}>
      {isMobile ? (
        <>
          {trigger}
          <PhoneSheet spec={spec} label={label} open={open} onOpenChange={setOpen} onRun={run} header={header} />
        </>
      ) : (
        <DesktopMenu spec={spec} open={open} onOpenChange={setOpen} onRun={run} trigger={trigger} header={header} />
      )}
      <ConfirmDialog item={pending} onClose={() => setPending(null)} />
    </span>
  );
}

function phoneTrigger({
  element,
  onOpen,
}: {
  element: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
  onOpen: () => void;
}) {
  return React.cloneElement(element, {
    onClick: (e: React.MouseEvent) => {
      element.props.onClick?.(e as React.MouseEvent<Element>);
      onOpen();
    },
  });
}

// Plain functions (not components): `DropdownMenuTrigger asChild` needs the Button
// element itself so its ref and props land on it.
function defaultTrigger({
  isMobile,
  onOpen,
  className,
  label,
}: {
  isMobile: boolean;
  onOpen: () => void;
  className?: string;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={isMobile ? onOpen : undefined}
      className={cn(
        "touch-target shrink-0 text-muted transition-opacity",
        isMobile ? "size-10" : "size-8 opacity-60 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
        className,
      )}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </Button>
  );
}

function MenuHeader({ header, sheet = false }: { header?: React.ReactNode; sheet?: boolean }) {
  if (!header) return null;
  return (
    <>
      <div data-slot="menu-header" className={cn("text-caption text-muted", sheet ? "px-4 pb-2" : "max-w-64 px-2.5 py-2")}>
        {header}
      </div>
      {sheet ? <BottomSheetSeparator /> : <DropdownMenuSeparator />}
    </>
  );
}

function ItemIcon({ item }: { item: ActionItem }) {
  const Icon = item.icon;
  return Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null;
}

const dangerClass = "text-t-out data-[highlighted]:bg-out-soft data-[highlighted]:text-t-out";

function DesktopItem({ item, onRun }: { item: ActionItem; onRun: (i: ActionItem) => void }) {
  if (item.children?.length) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ItemIcon item={item} />
          {item.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {item.children.map((c) => (
            <DesktopItem key={c.key} item={c} onRun={onRun} />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  return (
    <DropdownMenuItem onSelect={() => onRun(item)} className={cn(item.danger && dangerClass)}>
      <ItemIcon item={item} />
      <span className="flex-1">{item.label}</span>
      {item.kbd && <Kbd>{item.kbd}</Kbd>}
    </DropdownMenuItem>
  );
}

function DesktopMenu({
  spec,
  open,
  onOpenChange,
  onRun,
  trigger,
  header,
}: {
  spec: ActionMenuSpec;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRun: (i: ActionItem) => void;
  trigger: React.ReactElement;
  header?: React.ReactNode;
}) {
  const groups = groupActionItems(spec.items);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const hit = itemForShortcut(spec.items, e.key);
    if (!hit) return;
    e.preventDefault();
    onRun(hit);
  };
  return (
    // modal={false}: a confirm Dialog opens as the menu closes, and a modal
    // menu's body pointer-events lock would swallow its first click.
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" onKeyDown={onKeyDown}>
        <MenuHeader header={header} />
        {groups.map((g, i) => (
          <React.Fragment key={g.group}>
            {i > 0 && <DropdownMenuSeparator />}
            {g.items.map((item) => (
              <DesktopItem key={item.key} item={item} onRun={onRun} />
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PhoneSheet({
  spec,
  label,
  open,
  onOpenChange,
  onRun,
  header,
}: {
  spec: ActionMenuSpec;
  label: string;
  header?: React.ReactNode;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRun: (i: ActionItem) => void;
}) {
  const [parent, setParent] = React.useState<ActionItem | null>(null);
  const change = (o: boolean) => {
    if (!o) setParent(null);
    onOpenChange(o);
  };
  // Sub-level: a parent item swaps the sheet's list for its children (one level).
  const items = parent?.children ?? spec.items;
  const groups = groupActionItems(items);
  return (
    <BottomSheet open={open} onOpenChange={change} title={parent ? parent.label : label}>
      {!parent && <MenuHeader header={header} sheet />}
      {parent && (
        <BottomSheetItem keepOpen onSelect={() => setParent(null)} icon={<ChevronLeft />}>
          Back
        </BottomSheetItem>
      )}
      {groups.map((g, i) => (
        <React.Fragment key={g.group}>
          {i > 0 && <BottomSheetSeparator />}
          {g.items.map((item) => (
            <PhoneItem key={item.key} item={item} onOpenSub={setParent} onRun={onRun} />
          ))}
        </React.Fragment>
      ))}
    </BottomSheet>
  );
}

function PhoneItem({
  item,
  onOpenSub,
  onRun,
}: {
  item: ActionItem;
  onOpenSub: (i: ActionItem) => void;
  onRun: (i: ActionItem) => void;
}) {
  const hasSub = !!item.children?.length;
  return (
    <BottomSheetItem
      keepOpen={hasSub}
      danger={item.danger}
      icon={<ItemIcon item={item} />}
      trailing={hasSub ? <ChevronRight className="size-4 text-muted" aria-hidden="true" /> : undefined}
      onSelect={() => (hasSub ? onOpenSub(item) : onRun(item))}
    >
      {item.label}
    </BottomSheetItem>
  );
}

function ConfirmDialog({ item, onClose }: { item: ActionItem | null; onClose: () => void }) {
  const confirm = item?.confirm;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirm?.title}</DialogTitle>
          <DialogDescription>{confirm?.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              const run = item?.onSelect;
              onClose();
              void run?.();
            }}
          >
            {confirm?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
