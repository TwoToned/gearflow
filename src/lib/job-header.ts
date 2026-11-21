import {
  Archive, BookTemplate, ClipboardList, Copy, FileText, Lock, LockOpen, MessageCircle, Trash2, Warehouse,
} from "lucide-react";

import type { DetailHeaderProps } from "@/components/ui/detail-header";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import type { LabelIndexEntry } from "@/lib/pdfme/container-labels";
import { getStatusIntent } from "@/lib/status-colors";
import { formatDateDayMonth } from "@/lib/formatters";
import { labelGroup } from "@/lib/warehouse-label-items";
import { nextStage, progressFor, projectStatusLabel } from "@/lib/job-lifecycle";

/**
 * Header props for the job page's `DetailHeader` (spec §6b, D92): title ·
 * status word · lock glyph with its menu; number · client · dates; one primary
 * `Advance to …`; `Documents ▾`; `Edit`; ⋯. Pure, like `warehouse-job-header.ts`:
 * every permission is decided here, and an action the caller can't take is
 * ABSENT (principle 2), never disabled.
 *
 * Permissions mirror the server exactly: a status move and Edit need
 * `project:update` (`updateStatusNative`), Duplicate and Save as template need
 * `project:create`, Unlock pricing needs `project:update` + the
 * `canUnlockPricing` audience (`unlockPricingNative`).
 */

type WarehouseDocType ="manifest" | "pull-slip" | "delivery-docket" | "return-sheet";
export type LabelDocType = "container-label" | "kit-label" | "item-label";

export interface JobHeaderInput {
  name: string;
  status: string;
  isTemplate: boolean;
  can: { update: boolean; create: boolean };
  /** Absent while the lock read loads, or when pricing is open. */
  lock?: { headline: string; detail: string; canUnlockPricing: boolean } | null;
  /** Open blocking discussions on the job (the live summary). */
  blockingCount: number;
  advancing: boolean;
  /** The version submenu (`buildVersionMenuItem`, Phase 8 fills the same shape). */
  versionItem: ActionItem | null;
  /** The label lists, `null` until Documents ▾ is first opened (the "All" entry still works). */
  labels: Record<LabelDocType, LabelIndexEntry[] | null>;
  on: {
    advance: (nextStatus: string) => void;
    useTemplate: () => void;
    edit: () => void;
    openDocument: (type: WarehouseDocType) => void;
    openLabel: (type: LabelDocType, labelId?: string) => void;
    openCallSheet: () => void;
    openTimeline: () => void;
    openFinance: () => void;
    openComments: () => void;
    openWarehouse: () => void;
    openRunsheet: () => void;
    duplicate: () => void;
    saveAsTemplate: () => void;
    cancel: () => void;
    remove: () => void;
    unlock: () => void;
  };
}

const doc = (key: string, label: string, run: () => void): ActionItem => ({ key, label, group: "documents", icon: FileText, onSelect: run });

const WAREHOUSE_DOCS: ReadonlyArray<{ type: WarehouseDocType; label: string }> = [
  { type: "manifest", label: "Manifest" },
  { type: "pull-slip", label: "Pull slip" },
  { type: "delivery-docket", label: "Delivery docket" },
  { type: "return-sheet", label: "Return sheet" },
];

/**
 * Warehouse paperwork, labels, call sheet and timeline, then a pointer to
 * Finance. A sent quote or an issued invoice is STORED bytes and is opened
 * from Finance; this menu never renders either (#987, CLAUDE.md).
 */
function jobDocumentsSpec(i: Pick<JobHeaderInput, "labels" | "on">): ActionMenuSpec {
  const { on, labels } = i;
  return {
    items: [
      ...WAREHOUSE_DOCS.map((d) => doc(d.type, d.label, () => on.openDocument(d.type))),
      labelGroup("container-labels", "Case labels", "All cases", "container-label", labels["container-label"], on.openLabel),
      labelGroup("kit-labels", "Kit labels", "All kits", "kit-label", labels["kit-label"], on.openLabel),
      labelGroup("item-labels", "Loose item labels", "All loose items", "item-label", labels["item-label"], on.openLabel),
      doc("call-sheet", "Call sheet", on.openCallSheet),
      doc("timeline", "Job timeline", on.openTimeline),
      { key: "finance-docs", label: "Quote & invoice PDFs → Finance", group: "documents", onSelect: on.openFinance },
    ],
  };
}

const CANCEL_CONFIRM = {
  title: "Cancel this job?",
  body: "The job will be marked cancelled. Reservations release and items return to inventory. You can permanently delete a cancelled job later.",
  confirmLabel: "Cancel job",
};

const DELETE_CONFIRM = {
  title: "Delete job?",
  body: "This permanently removes the job and its line items, crew assignments, and documents. This cannot be undone.",
  confirmLabel: "Delete job",
};

function dangerItems(i: JobHeaderInput): ActionItem[] {
  if (!i.can.update) return [];
  if (i.status === "CANCELLED") {
    return [{ key: "delete", label: "Delete job…", group: "danger", danger: true, icon: Trash2, onSelect: i.on.remove, confirm: DELETE_CONFIRM }];
  }
  return [{ key: "cancel", label: "Cancel job…", group: "danger", danger: true, icon: Archive, onSelect: i.on.cancel, confirm: CANCEL_CONFIRM }];
}

/**
 * The header ⋯, in §6b's order: Comments & discussion · Warehouse page ·
 * Runsheet · Version ▸ · Duplicate · Save as template, then the danger verb
 * last and red. All but the danger verb are `organise`, because the renderer
 * sorts by the fixed group order. A template has no ⋯.
 */
function jobMenuSpec(i: JobHeaderInput): ActionMenuSpec {
  if (i.isTemplate) return { items: [] };
  const comments = i.blockingCount > 0 ? `Comments & discussion · ${i.blockingCount} blocking` : "Comments & discussion";
  const items: ActionItem[] = [
    { key: "comments", label: comments, group: "organise", icon: MessageCircle, onSelect: i.on.openComments },
    { key: "warehouse", label: "Warehouse page", group: "organise", icon: Warehouse, onSelect: i.on.openWarehouse },
    { key: "runsheet", label: "Runsheet", group: "organise", icon: ClipboardList, onSelect: i.on.openRunsheet },
    ...(i.versionItem ? [i.versionItem] : []),
  ];
  if (i.can.create) {
    items.push(
      { key: "duplicate", label: "Duplicate job", group: "organise", icon: Copy, onSelect: i.on.duplicate },
      { key: "save-template", label: "Save as template", group: "organise", icon: BookTemplate, onSelect: i.on.saveAsTemplate },
    );
  }
  return { items: [...items, ...dangerItems(i)] };
}

const UNLOCK_CONFIRM = {
  title: "Unlock pricing?",
  body: "Prices, discounts, rates and tax become editable again on the live version. Documents already sent or issued keep their stored copies. Undo locks it again.",
  confirmLabel: "Unlock pricing",
};

/**
 * The lock glyph's menu. The header says who locked it and what is read-only;
 * the one verb is Unlock pricing, present only for the server's audience. It
 * always carries the Finance link, so the glyph never disappears for someone
 * who can't unlock (an empty `ActionMenu` renders nothing).
 */
function jobLockProps(i: JobHeaderInput): DetailHeaderProps["lock"] {
  if (!i.lock || i.isTemplate) return undefined;
  const items: ActionItem[] = [
    { key: "lock-finance", label: "Quotes and invoices", group: "organise", icon: Lock, onSelect: i.on.openFinance },
  ];
  if (i.can.update && i.lock.canUnlockPricing) {
    items.unshift({ key: "unlock", label: "Unlock pricing", group: "edit", icon: LockOpen, onSelect: i.on.unlock, confirm: UNLOCK_CONFIRM });
  }
  return { label: i.lock.headline, summary: `${i.lock.headline}: ${i.lock.detail}`, menu: { items } };
}

function primaryFor(i: JobHeaderInput): DetailHeaderProps["primary"] {
  if (i.isTemplate) return i.can.create ? { label: "Use template", onSelect: i.on.useTemplate } : undefined;
  const next = nextStage(i.status);
  if (!next || !i.can.update) return undefined;
  return { label: `Advance to ${next.label}`, onSelect: () => i.on.advance(next.status), disabled: i.advancing };
}

/** Everything but the meta line (the component renders its client link) and the progress line's `Set status ▾`. */
export function jobHeaderProps(i: JobHeaderInput): Omit<DetailHeaderProps, "meta"> {
  const progress = i.isTemplate ? null : progressFor(i.status);
  return {
    title: i.name,
    status: i.isTemplate
      ? { label: "Template", intent: "info" }
      : { label: projectStatusLabel(i.status), intent: getStatusIntent("project", i.status) },
    lock: jobLockProps(i),
    primary: primaryFor(i),
    documents: i.isTemplate ? undefined : jobDocumentsSpec(i),
    onEdit: i.can.update ? i.on.edit : undefined,
    menu: jobMenuSpec(i),
    progress: progress ?? undefined,
    phonePrimaryBelowProgress: true,
  };
}

const DAY_MS = 86_400_000;

/** Calendar days, start and end inclusive, read in local time (a hire day is a date, not 24 h). */
function inclusiveDays(start: Date, end: Date): number {
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1);
}

/** The meta line's dates: `12 Oct – 14 Oct · 3 days`, `12 Oct · 1 day`, or null with no rental dates. */
export function rentalDatesLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : s;
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const days = inclusiveDays(s, e);
  const span = days === 1 ? formatDateDayMonth(s) : `${formatDateDayMonth(s)} – ${formatDateDayMonth(e)}`;
  return `${span} · ${days} ${days === 1 ? "day" : "days"}`;
}
