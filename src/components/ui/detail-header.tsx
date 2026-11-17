"use client";

import * as React from "react";
import { ChevronDown, Lock } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusWord } from "@/components/ui/status-word";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ActionItem, ActionMenuSpec, StatusValue } from "@/lib/primitives/types";
import { groupActionItems } from "@/lib/row-actions/group-items";
import { cn } from "@/lib/utils";

/**
 * `DetailHeader` (spec §5.9 as amended by D92, built to §6b's calm header):
 * title · status word · a small lock glyph with its menu; a meta line; one
 * primary, `Documents ▾`, `Edit`, ⋯; a thin progress line; and ONE quiet strip
 * slot for a non-live version. No chips: the version lives in ⋯ and under `V`,
 * the lock is the glyph, not a banner. The warehouse variant swaps the meta
 * line for the packer's facts.
 */
export interface DetailHeaderStep {
  key: string;
  label: string;
}

export interface PackerFacts {
  loadsOut?: string;
  truck?: string;
  packing?: string[];
}

export interface DetailHeaderProps {
  title: string;
  status: StatusValue;
  /** The pricing-lock glyph. `summary` says who, when, what is read-only. */
  lock?: { label: string; summary: React.ReactNode; menu: ActionMenuSpec };
  /** Job variant: number · client · dates · days, joined with a middle dot. */
  meta?: React.ReactNode[];
  /** Warehouse variant: the packer's facts replace the meta line. */
  variant?: "job" | "warehouse";
  packerFacts?: PackerFacts;
  /** The one primary, e.g. `Advance to Prep`. Absent at the end of the pipeline. */
  primary?: { label: string; onSelect: () => void | Promise<void>; disabled?: boolean };
  documents?: ActionMenuSpec;
  onEdit?: () => void;
  menu?: ActionMenuSpec;
  /** Thin progress line: done = ink, current = red, upcoming = hairline. */
  progress?: {
    steps: DetailHeaderStep[];
    currentIndex: number;
    /** Sub-status under a two-status stage (`Quote · quoted`). */
    subLabel?: string;
    /** e.g. a `Set status ▾` text link, rendered under the line. */
    action?: React.ReactNode;
  };
  /** The one quiet strip, only when it matters (a viewed non-live version). */
  strip?: React.ReactNode;
  className?: string;
}

/**
 * A menu for an `ActionMenuSpec` behind a custom trigger (`Documents ▾`, the
 * lock glyph). `ActionMenu` only owns the ⋯ trigger; this reuses its group
 * order (`groupActionItems`) and the same primitives (DropdownMenu on desktop,
 * the shared `BottomSheet` on phone, a Dialog for `confirm`).
 */
function SpecMenu({
  spec,
  header,
  trigger,
  title,
}: {
  spec: ActionMenuSpec;
  header?: React.ReactNode;
  trigger: (props: { onClick?: () => void }) => React.ReactElement;
  title: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<ActionItem | null>(null);
  const groups = groupActionItems(spec.items);
  const run = (item: ActionItem) => {
    setOpen(false);
    if (item.confirm) setPending(item);
    else void item.onSelect();
  };

  return (
    <>
      {isMobile ? (
        <>
          {trigger({ onClick: () => setOpen(true) })}
          <BottomSheet open={open} onOpenChange={setOpen} title={title}>
            {header ? <div className="px-4 pb-2 text-[13px] text-muted">{header}</div> : null}
            {groups.map((g, i) => (
              <React.Fragment key={g.group}>
                {i > 0 && <BottomSheetSeparator />}
                {g.items.map((item) => (
                  <BottomSheetItem key={item.key} danger={item.danger} onSelect={() => run(item)}>
                    {item.label}
                  </BottomSheetItem>
                ))}
              </React.Fragment>
            ))}
          </BottomSheet>
        </>
      ) : (
        // modal={false}: a confirm Dialog opens as the menu closes.
        <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
          <DropdownMenuTrigger asChild>{trigger({})}</DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-xs">
            {header ? <DropdownMenuLabel className="font-normal text-muted">{header}</DropdownMenuLabel> : null}
            {header && groups.length > 0 ? <DropdownMenuSeparator /> : null}
            {groups.map((g, i) => (
              <React.Fragment key={g.group}>
                {i > 0 && <DropdownMenuSeparator />}
                {g.items.map((item) => (
                  <DropdownMenuItem key={item.key} onSelect={() => run(item)}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.confirm?.title}</DialogTitle>
            <DialogDescription>{pending?.confirm?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const go = pending?.onSelect;
                setPending(null);
                void go?.();
              }}
            >
              {pending?.confirm?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PackerFactsLine({ facts }: { facts: PackerFacts }) {
  const parts = [
    facts.loadsOut ? `Loads out ${facts.loadsOut}` : null,
    facts.truck ? `Truck ${facts.truck}` : null,
    facts.packing?.length ? `Packing ${facts.packing.join(", ")}` : null,
  ].filter((p): p is string => !!p);
  return <MetaLine parts={parts} />;
}

function MetaLine({ parts }: { parts: React.ReactNode[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{p}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function Progress({ progress }: { progress: NonNullable<DetailHeaderProps["progress"]> }) {
  const { steps, currentIndex, subLabel, action } = progress;
  return (
    <div>
      <ol className="flex gap-1" aria-label="Progress">
        {steps.map((s, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
          return (
            <li
              key={s.key}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              // Phone: only the current label shows (§6b).
              className={cn("min-w-0 flex-1", state !== "current" && "max-md:[&>span]:hidden")}
            >
              <i
                className={cn(
                  "mb-1.5 block h-[3px] rounded-sm",
                  state === "done" && "bg-ink-2",
                  state === "current" && "bg-red",
                  state === "upcoming" && "bg-line-2",
                )}
              />
              <span
                className={cn(
                  "block truncate text-[11px]",
                  state === "current" ? "font-semibold text-ink" : "text-faint",
                )}
              >
                {s.label}
                {state === "current" && subLabel ? ` · ${subLabel}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {action ? <div className="mt-1.5 flex justify-end">{action}</div> : null}
    </div>
  );
}

export function DetailHeader({
  title,
  status,
  lock,
  meta,
  variant = "job",
  packerFacts,
  primary,
  documents,
  onEdit,
  menu,
  progress,
  strip,
  className,
}: DetailHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
            <StatusWord status={status} />
            {lock ? (
              <SpecMenu
                spec={lock.menu}
                header={lock.summary}
                title={lock.label}
                trigger={(p) => (
                  <button
                    type="button"
                    aria-label={lock.label}
                    title={lock.label}
                    {...p}
                    className="inline-flex size-[22px] items-center justify-center rounded-full border border-line-2 text-muted hover:border-control-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red [@media(pointer:coarse)]:size-11"
                  >
                    <Lock className="size-[11px]" aria-hidden="true" />
                  </button>
                )}
              />
            ) : null}
          </div>
          {variant === "warehouse" && packerFacts ? (
            <PackerFactsLine facts={packerFacts} />
          ) : meta?.length ? (
            <MetaLine parts={meta} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {primary ? (
            <Button size="sm" disabled={primary.disabled} onClick={() => void primary.onSelect()}>
              {primary.label}
            </Button>
          ) : null}
          {documents?.items.length ? (
            <SpecMenu
              spec={documents}
              title="Documents"
              trigger={(p) => (
                <Button type="button" size="sm" variant="line" {...p}>
                  Documents
                  <ChevronDown className="size-3" aria-hidden="true" />
                </Button>
              )}
            />
          ) : null}
          {onEdit ? (
            <Button type="button" size="sm" variant="line" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          {menu ? <ActionMenu spec={menu} label="More actions" /> : null}
        </div>
      </div>
      {progress ? <Progress progress={progress} /> : null}
      {strip ? <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-paper-2 px-3.5 py-2.5 text-[13px] text-ink-2">{strip}</div> : null}
    </header>
  );
}
