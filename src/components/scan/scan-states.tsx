"use client";

import Link from "next/link";

import type { ScanCardData } from "@/lib/scan-page";
import { cn, focusRing } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Scan page's states that are not a checkable asset (spec §9i.3). None of them
 * blocks the dock: each says what the tag is and offers the next step as words.
 */
function State({ tag, title, children }: { tag?: string; title: string; children?: React.ReactNode }) {
  return (
    <section aria-live="polite" className="flex flex-col gap-2 border-y border-line py-6">
      {tag ? <span className="font-mono text-ui-text font-semibold text-ink">{tag}</span> : null}
      <p className="text-ui-text text-ink">{title}</p>
      {children ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">{children}</div> : null}
    </section>
  );
}

const linkClass = cn("inline-flex min-h-11 items-center font-medium text-link hover:underline [@media(pointer:fine)]:min-h-8", focusRing);

function Word({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="sm" className="px-1 text-link" onClick={onClick}>
      {children}
    </Button>
  );
}

export function ReadyState() {
  return <State title="Scan a tag to check it" />;
}

export function LoadingState() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-6 w-40 rounded-[var(--r)]" />
      <Skeleton className="h-24 rounded-[var(--r)]" />
    </div>
  );
}

/**
 * Not a checkable asset: an unknown tag, a kit, bulk stock, a T&T-only item, or a
 * model with no check items. `onScanAgain` / `onType` focus the dock.
 */
interface ExceptionProps {
  card: ScanCardData;
  onScanAgain: () => void;
  onType: () => void;
  canRegister: boolean;
  canCheckItemSettings: boolean;
}

function UnknownState({ card, onScanAgain, onType, canRegister }: ExceptionProps) {
  return (
    <State tag={card.tag} title="No asset carries this tag">
      <Action onClick={onScanAgain}>Scan again</Action>
      <Action onClick={onType}>Type the tag</Action>
      {canRegister ? <Word href="/assets/registry/new">Register an asset with this tag</Word> : null}
    </State>
  );
}

function KitState({ card }: ExceptionProps) {
  const kit = card.kit;
  if (!kit) return null;
  return (
    <State tag={kit.assetTag} title={`${kit.name} is a kit: scan a unit in it`}>
      <Word href={`/kits/${kit.id}`}>Open kit</Word>
    </State>
  );
}

function BulkState({ card }: ExceptionProps) {
  const bulk = card.bulk;
  if (!bulk) return null;
  return (
    <State tag={bulk.assetTag} title="Bulk stock is checked per unit on a job">
      <Word href={`/assets/registry/${bulk.id}`}>Open asset</Word>
    </State>
  );
}

function TtOnlyState({ card }: ExceptionProps) {
  const tt = card.tt;
  if (!tt) return null;
  return (
    <State tag={tt.testTagId} title={`${tt.description} is on the test & tag register, not in inventory`}>
      <Word href={`/test-and-tag/${tt.id}`}>Open in test & tag list</Word>
    </State>
  );
}

function NoItemsState({ card, canCheckItemSettings }: ExceptionProps) {
  return (
    <State tag={card.tag} title={`${card.asset?.modelName ?? "This model"} has no check items`}>
      {canCheckItemSettings ? <Word href="/settings/check-items">Add check items ↗</Word> : null}
      {card.asset ? <Word href={`/assets/registry/${card.asset.id}`}>Open asset</Word> : null}
    </State>
  );
}

const EXCEPTION_STATES: Record<ScanCardData["kind"], (p: ExceptionProps) => React.ReactNode> = {
  unknown: UnknownState,
  kit: KitState,
  bulk: BulkState,
  ttOnly: TtOnlyState,
  asset: NoItemsState,
};

export function ExceptionState(props: ExceptionProps) {
  const Render = EXCEPTION_STATES[props.card.kind];
  return <Render {...props} />;
}
