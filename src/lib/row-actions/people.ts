import { Archive, CalendarDays, ExternalLink, FilePlus, Mail, MessageSquare, Pencil, Receipt, RotateCcw, Send, Tag, UserMinus, UserPlus, Clock, Download, Briefcase, Package } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";

/**
 * The People lists' row ⋯ and bulk verbs (UX Phase 13, spec §9f.2). An omitted
 * handler means the caller cannot do it (no permission, no write), so the item is
 * ABSENT, never disabled. Destructive verbs go last and red and carry a confirm
 * that says what stays. Every verb has a write or a route behind it already.
 */
type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);
const compactBulk = (entries: (BulkAction | false | undefined | null)[]): BulkAction[] => entries.filter((e): e is BulkAction => !!e);

// ─── Crew ────────────────────────────────────────────────────────────────

export interface CrewMenuRow {
  name: string;
  /** Stored/derived status: only Unconfirmed offers `Resend offer`; only Inactive offers `Reactivate`. */
  listStatus: string;
  hasEmail: boolean;
}
export interface CrewMenuCtx {
  onOpen: () => void;
  onOpenInPlanner?: () => void;
  onMessage?: () => void;
  onAssign?: () => void;
  onResendOffer?: () => void;
  onLogTime?: () => void;
  onDeactivate?: () => void;
  onReactivate?: () => void;
}

/** A handler only when the caller may do it, so the verb is ABSENT (never disabled) for a read-only role. */
export function when<F extends () => void>(allowed: boolean, handler: F): F | undefined {
  return allowed ? handler : undefined;
}

/** One verb: present only when its handler was given (the caller may do it) AND every condition holds. */
function verb(handler: (() => void) | undefined, conditions: boolean[], spec: Omit<ActionItem, "onSelect">): Entry {
  return handler && conditions.every(Boolean) ? { ...spec, onSelect: handler } : false;
}

export function crewMemberActions(row: CrewMenuRow, ctx: CrewMenuCtx): ActionMenuSpec {
  const active = row.listStatus !== "INACTIVE";
  const unconfirmed = row.listStatus === "UNCONFIRMED";
  return {
    items: compact([
      { key: "open", label: "Open", group: "edit", icon: Pencil, onSelect: ctx.onOpen },
      verb(ctx.onOpenInPlanner, [true], { key: "planner", label: "Open in planner", group: "edit", icon: CalendarDays }),
      verb(ctx.onMessage, [row.hasEmail, active], { key: "message", label: "Message…", group: "edit", icon: MessageSquare }),
      verb(ctx.onAssign, [active], { key: "assign", label: "Assign to job…", group: "organise", icon: UserPlus }),
      verb(ctx.onResendOffer, [unconfirmed, row.hasEmail], { key: "resend", label: "Resend offer", group: "organise", icon: Send }),
      verb(ctx.onLogTime, [active], { key: "log-time", label: "Log time…", group: "reporting", icon: Clock }),
      verb(ctx.onReactivate, [!active], { key: "reactivate", label: "Reactivate", group: "organise", icon: RotateCcw }),
      verb(ctx.onDeactivate, [active], {
        key: "deactivate",
        label: "Deactivate…",
        group: "danger",
        icon: UserMinus,
        danger: true,
        confirm: {
          title: `Deactivate ${row.name}?`,
          body: "They leave the active roster and the planner. Calls they already hold stay as they are, and their timesheets and history are kept. You can reactivate them.",
          confirmLabel: "Deactivate",
        },
      }),
    ]),
  };
}

export interface CrewBulkCtx {
  onMessage?: () => void;
  onAssign?: () => void;
  onAddTag?: () => void;
  onDeactivate?: () => void;
}

/** `Message n`, `Assign n to job…`, `Add tag…`, `Deactivate n` (red, last). */
export function crewBulkActions(ctx: CrewBulkCtx): BulkAction[] {
  return compactBulk([
    ctx.onMessage && { key: "message", group: "edit", icon: MessageSquare, label: (n) => `Message ${n}`, onSelect: ctx.onMessage },
    ctx.onAssign && { key: "assign", group: "organise", icon: UserPlus, label: (n) => `Assign ${n} to job…`, onSelect: ctx.onAssign },
    ctx.onAddTag && { key: "tag", group: "organise", icon: Tag, label: () => "Add tag…", onSelect: ctx.onAddTag },
    ctx.onDeactivate && {
      key: "deactivate", group: "danger", icon: UserMinus, danger: true, label: (n) => `Deactivate ${n}`, onSelect: ctx.onDeactivate,
      confirm: { title: "Deactivate the selected crew?", body: "They leave the active roster. People holding a confirmed call stay and are named, calls already held, timesheets and history are kept, and you can reactivate anyone.", confirmLabel: "Deactivate" },
    },
  ]);
}

// ─── Clients ─────────────────────────────────────────────────────────────

export interface ClientMenuRow {
  name: string;
  isActive: boolean;
  firstOpenJob?: { projectNumber: string } | null;
  xeroLinked: boolean;
}
export interface ClientMenuCtx {
  onOpen: () => void;
  onOpenJob?: () => void;
  onNewJob?: () => void;
  onOpenInvoices?: () => void;
  onOpenInXero?: () => void;
  onAddTag?: () => void;
  onArchive?: () => void;
  onReactivate?: () => void;
}

export function clientActions(row: ClientMenuRow, ctx: ClientMenuCtx): ActionMenuSpec {
  return {
    items: compact([
      { key: "open", label: "Open", group: "edit", icon: Pencil, onSelect: ctx.onOpen },
      verb(ctx.onOpenJob, [!!row.firstOpenJob], { key: "open-job", label: `Open job ${row.firstOpenJob?.projectNumber ?? ""}`.trim(), group: "edit", icon: Briefcase }),
      verb(ctx.onNewJob, [row.isActive], { key: "new-job", label: "New job for client…", group: "organise", icon: FilePlus }),
      verb(ctx.onOpenInvoices, [true], { key: "invoices", label: "Open invoices", group: "reporting", icon: Receipt }),
      verb(ctx.onOpenInXero, [row.xeroLinked], { key: "xero", label: "Open in Xero", group: "reporting", icon: ExternalLink }),
      verb(ctx.onAddTag, [true], { key: "tag", label: "Add tag…", group: "organise", icon: Tag }),
      verb(ctx.onReactivate, [!row.isActive], { key: "reactivate", label: "Reactivate", group: "organise", icon: RotateCcw }),
      verb(ctx.onArchive, [row.isActive], {
        key: "archive",
        label: "Archive…",
        group: "danger",
        icon: Archive,
        danger: true,
        confirm: {
          title: `Archive ${row.name}?`,
          body: "The client leaves pickers and the active list. Its jobs, quotes, invoices and history stay exactly as they were, and you can reactivate it.",
          confirmLabel: "Archive",
        },
      }),
    ]),
  };
}

export interface ClientBulkCtx {
  onAddTag?: () => void;
  onExport?: () => void;
  onArchive?: () => void;
}

export function clientBulkActions(ctx: ClientBulkCtx): BulkAction[] {
  return compactBulk([
    ctx.onAddTag && { key: "tag", group: "organise", icon: Tag, label: () => "Add tag…", onSelect: ctx.onAddTag },
    ctx.onExport && { key: "export", group: "reporting", icon: Download, label: () => "Export", onSelect: ctx.onExport },
    ctx.onArchive && {
      key: "archive", group: "danger", icon: Archive, danger: true, label: (n) => `Archive ${n}`, onSelect: ctx.onArchive,
      confirm: { title: "Archive the selected clients?", body: "They leave pickers and the active list. Clients with open jobs stay and are named. Jobs, quotes, invoices and history are kept, and you can reactivate any of them.", confirmLabel: "Archive" },
    },
  ]);
}

// ─── Suppliers ───────────────────────────────────────────────────────────

export interface SupplierMenuRow {
  name: string;
  isActive: boolean;
  email?: string | null;
}
export interface SupplierMenuCtx {
  onOpen: () => void;
  onOrders?: () => void;
  onNewOrder?: () => void;
  onEmail?: () => void;
  onAddTag?: () => void;
  onArchive?: () => void;
  onReactivate?: () => void;
}

export function supplierActions(row: SupplierMenuRow, ctx: SupplierMenuCtx): ActionMenuSpec {
  return {
    items: compact([
      { key: "open", label: "Open", group: "edit", icon: Pencil, onSelect: ctx.onOpen },
      verb(ctx.onOrders, [true], { key: "orders", label: "Orders…", group: "edit", icon: Package }),
      verb(ctx.onNewOrder, [row.isActive], { key: "new-order", label: "New order…", group: "organise", icon: FilePlus }),
      verb(ctx.onEmail, [!!row.email], { key: "email", label: "Email supplier…", group: "reporting", icon: Mail }),
      verb(ctx.onAddTag, [true], { key: "tag", label: "Add tag…", group: "organise", icon: Tag }),
      verb(ctx.onReactivate, [!row.isActive], { key: "reactivate", label: "Reactivate", group: "organise", icon: RotateCcw }),
      verb(ctx.onArchive, [row.isActive], {
        key: "archive",
        label: "Archive…",
        group: "danger",
        icon: Archive,
        danger: true,
        confirm: {
          title: `Archive ${row.name}?`,
          body: "The supplier leaves pickers and the active list. Its orders, sub-hires and history stay as they were, and you can reactivate it.",
          confirmLabel: "Archive",
        },
      }),
    ]),
  };
}

export interface SupplierBulkCtx {
  onExport?: () => void;
  onAddTag?: () => void;
  onArchive?: () => void;
}

export function supplierBulkActions(ctx: SupplierBulkCtx): BulkAction[] {
  return compactBulk([
    ctx.onExport && { key: "export", group: "reporting", icon: Download, label: () => "Export", onSelect: ctx.onExport },
    ctx.onAddTag && { key: "tag", group: "organise", icon: Tag, label: () => "Add tag…", onSelect: ctx.onAddTag },
    ctx.onArchive && {
      key: "archive", group: "danger", icon: Archive, danger: true, label: (n) => `Archive ${n}`, onSelect: ctx.onArchive,
      confirm: { title: "Archive the selected suppliers?", body: "They leave pickers and the active list. Orders, sub-hires and history are kept, and you can reactivate any of them.", confirmLabel: "Archive" },
    },
  ]);
}
