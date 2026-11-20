import { Copy, FileStack, Tag, Download, Trash2, XCircle } from "lucide-react";

import { JOB_STATUS_ORDER, jobStatusLabel } from "@/lib/list-views/jobs";
import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/** The facts about a job the menu depends on. */
export interface JobActionRow {
  title: string;
  status?: string | null;
}

/**
 * Handlers: an omitted handler means the caller cannot do it (no permission, no
 * write), so the item is ABSENT, never disabled. Every verb here already has a
 * write behind it (`projectWrites.*`).
 */
export interface JobActionCtx {
  onSetStatus?: (status: string) => void;
  onDuplicate?: () => void;
  onSaveAsTemplate?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
}

type Entry = ActionItem | false | undefined | null;

const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);

/** Statuses a row can be moved to by hand. CANCELLED is its own verb (`Cancel job`). */
function moveTargets(current: string | null | undefined): string[] {
  return JOB_STATUS_ORDER.filter((s) => s !== "CANCELLED" && s !== current);
}

function statusItem(row: JobActionRow, ctx: JobActionCtx): Entry {
  const targets = moveTargets(row.status);
  if (!ctx.onSetStatus || row.status === "CANCELLED" || targets.length === 0) return false;
  const set = ctx.onSetStatus;
  return {
    key: "set-status",
    label: "Set status",
    group: "edit",
    onSelect: () => {},
    children: targets.map((s) => ({ key: `status-${s}`, label: jobStatusLabel(s), group: "edit" as const, onSelect: () => set(s) })),
  };
}

function dangerItems(row: JobActionRow, ctx: JobActionCtx): Entry[] {
  const cancelled = row.status === "CANCELLED";
  return [
    ctx.onCancel && !cancelled && {
      key: "cancel",
      label: "Cancel job",
      group: "danger",
      icon: XCircle,
      danger: true,
      onSelect: ctx.onCancel,
      confirm: {
        title: `Cancel ${row.title}?`,
        body: "The job is set to Cancelled: its gear reservations are released and it leaves the active lists. You can move it back to another status afterwards.",
        confirmLabel: "Cancel job",
      },
    },
    ctx.onDelete && cancelled && {
      key: "delete",
      label: "Delete job",
      group: "danger",
      icon: Trash2,
      danger: true,
      onSelect: ctx.onDelete,
      confirm: {
        title: `Delete ${row.title}?`,
        body: "This removes the job and everything on it for good. Only cancelled jobs can be deleted. This cannot be undone.",
        confirmLabel: "Delete job",
      },
    },
  ];
}

/** The row's ⋯ menu for one job. */
export function buildJobActions(row: JobActionRow, ctx: JobActionCtx): ActionMenuSpec {
  return {
    items: compact([
      statusItem(row, ctx),
      ctx.onDuplicate && { key: "duplicate", label: "Duplicate", group: "organise", icon: Copy, onSelect: ctx.onDuplicate },
      ctx.onSaveAsTemplate && { key: "template", label: "Save as template", group: "organise", icon: FileStack, onSelect: ctx.onSaveAsTemplate },
      ...dangerItems(row, ctx),
    ]),
  };
}

// ─── Bulk ────────────────────────────────────────────────────────────────

/** A bulk verb receives the selection; the page's handler applies per-row gates and names what it skipped. */
export interface JobBulkCtx {
  onSetStatus?: (status: string) => void;
  onAddTag?: () => void;
  onExport?: () => void;
  onCancel?: () => void;
}

/**
 * Bulk set-status targets. CONFIRMED is left to the row menu and the job page:
 * confirming is the one move with a non-blocking overbooking preview
 * (`useConfirmStatusGate`), and that dialog is per job.
 */
export function bulkStatusTargets(): string[] {
  return JOB_STATUS_ORDER.filter((s) => s !== "CANCELLED" && s !== "CONFIRMED");
}

export function buildJobBulkActions(ctx: JobBulkCtx): BulkAction[] {
  const setStatus = ctx.onSetStatus;
  const actions: (BulkAction | false | undefined)[] = [
    setStatus && {
      key: "set-status",
      label: (n) => `Set status ${n}`,
      group: "edit",
      onSelect: () => {},
      children: bulkStatusTargets().map((s) => ({
        key: `status-${s}`,
        label: () => jobStatusLabel(s),
        group: "edit" as const,
        onSelect: () => setStatus(s),
      })),
    },
    ctx.onAddTag && { key: "add-tag", label: (n) => `Add tag ${n}`, group: "organise", icon: Tag, onSelect: ctx.onAddTag },
    ctx.onExport && { key: "export", label: (n) => `Export ${n}`, group: "reporting", icon: Download, onSelect: ctx.onExport },
    ctx.onCancel && {
      key: "cancel",
      label: (n) => `Cancel ${n} ${n === 1 ? "job" : "jobs"}`,
      group: "danger",
      icon: XCircle,
      danger: true,
      onSelect: ctx.onCancel,
      confirm: {
        title: "Cancel the selected jobs?",
        body: "Each job is set to Cancelled and its gear reservations are released. Jobs already cancelled are skipped. Undo is offered for a few seconds.",
        confirmLabel: "Cancel jobs",
      },
    },
  ];
  return actions.filter((a): a is BulkAction => !!a);
}
