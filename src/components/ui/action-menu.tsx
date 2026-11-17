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
}: {
  spec: ActionMenuSpec;
  label?: string;
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

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        "shrink-0 text-muted transition-opacity",
        isMobile ? "size-10" : "size-8 opacity-60 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
        triggerClassName,
      )}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </Button>
  );

  return (
    <span className={className}>
      {isMobile ? (
        <>
          {trigger}
          <PhoneSheet spec={spec} label={label} open={open} onOpenChange={setOpen} onRun={run} />
        </>
      ) : (
        <DesktopMenu spec={spec} open={open} onOpenChange={setOpen} onRun={run} trigger={trigger} />
      )}
      <ConfirmDialog item={pending} onClose={() => setPending(null)} />
    </span>
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
}: {
  spec: ActionMenuSpec;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRun: (i: ActionItem) => void;
  trigger: React.ReactElement;
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
}: {
  spec: ActionMenuSpec;
  label: string;
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
