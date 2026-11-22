import { Ban, CalendarCheck, ExternalLink, Send, UserRound, UserPlus, Users } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import { canCrewCall, TOLD_ON_CANCEL } from "../../../convex/lib/crewCallTransitions";

/**
 * The crew planner's block ⋯, Needs crew row ⋯ and bulk bar (UX Phase 15,
 * spec §9h.3). Which verb a call offers comes from the ONE transition table
 * the server gates on (`convex/lib/crewCallTransitions.ts`). A verb whose
 * handler is absent (no permission) or that would not change the call is
 * ABSENT, never disabled. Offer and Cancel email the crew, so each carries a
 * confirm and its toast has no Undo (Q-S3).
 */
type Entry = ActionItem | false | undefined | null;
const compact = (entries: Entry[]): ActionItem[] => entries.filter((e): e is ActionItem => !!e);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export interface CrewCallRow {
  status?: string | null;
  /** `Ana Ruiz · #2341 Bump in`, for the confirms. */
  title: string;
}

export interface CrewCallCtx {
  onOffer?: () => void;
  onConfirm?: () => void;
  onOpenJob?: () => void;
  onOpenPerson?: () => void;
  onCancel?: () => void;
}

/** The offer confirm: it emails now and cannot be unsent. */
export function offerConfirm(n: number, resend = false): ActionItem["confirm"] {
  const what = resend ? "the offer again" : `${n} ${plural(n, "offer", "offers")}`;
  return {
    title: resend ? "Resend the offer?" : `Send ${what}?`,
    body: `Each person gets an email with Accept and Decline now. ${plural(n, "It", "They")} can't be unsent, so there is no Undo.`,
    confirmLabel: resend ? "Resend offer" : `Send ${n} ${plural(n, "offer", "offers")}`,
  };
}

/** The cancel confirm (§9h.3): the slot reopens, offered people are told, timesheets stay. */
export function cancelConfirm(statuses: readonly (string | null | undefined)[]): NonNullable<ActionItem["confirm"]> {
  const n = statuses.length;
  const told = statuses.filter((s) => TOLD_ON_CANCEL.has(s ?? "PENDING")).length;
  const tell = told ? ` ${told} ${plural(told, "person has", "people have")} been offered or confirmed and will be emailed.` : "";
  return {
    title: `Cancel ${n} ${plural(n, "call", "calls")}?`,
    body: `The ${plural(n, "slot opens", "slots open")} again under Needs crew.${tell} Timesheets for these days stay as they are. This can't be undone.`,
    confirmLabel: `Cancel ${n} ${plural(n, "call", "calls")}`,
  };
}

/** A call block's ⋯. */
export function buildCrewCallActions(row: CrewCallRow, ctx: CrewCallCtx): ActionMenuSpec {
  const status = row.status ?? "PENDING";
  const resend = status === "OFFERED";
  return {
    items: compact([
      !!ctx.onOffer && canCrewCall(status, "offer") && {
        key: "offer", label: resend ? "Resend offer" : "Offer", group: "edit", icon: Send, onSelect: ctx.onOffer, confirm: offerConfirm(1, resend),
      },
      !!ctx.onConfirm && canCrewCall(status, "confirm") && { key: "confirm", label: "Confirm", group: "edit", icon: CalendarCheck, onSelect: ctx.onConfirm },
      ctx.onOpenJob && { key: "job", label: "Open job", group: "organise", icon: ExternalLink, onSelect: ctx.onOpenJob },
      ctx.onOpenPerson && { key: "person", label: "Open crew member", group: "organise", icon: UserRound, onSelect: ctx.onOpenPerson },
      !!ctx.onCancel && canCrewCall(status, "cancel") && {
        key: "cancel", label: "Cancel call…", group: "danger", icon: Ban, danger: true, onSelect: ctx.onCancel, confirm: cancelConfirm([status]),
      },
    ]),
  };
}

export interface OpenCallCtx {
  onOfferTo?: () => void;
  /** Absent when nobody free has the role. */
  onOfferSuggested?: () => void;
  suggestedCount?: number;
  onOpenJob?: () => void;
}

/** A Needs crew row's ⋯: Offer to…, Offer to suggested, Open job. */
export function buildOpenCallActions(ctx: OpenCallCtx): ActionMenuSpec {
  const n = ctx.suggestedCount ?? 0;
  return {
    items: compact([
      ctx.onOfferTo && { key: "offer-to", label: "Offer to…", group: "edit", icon: UserPlus, onSelect: ctx.onOfferTo },
      !!ctx.onOfferSuggested && n > 0 && {
        key: "suggested", label: "Offer to suggested", group: "edit", icon: Users, onSelect: ctx.onOfferSuggested, confirm: offerConfirm(n),
      },
      ctx.onOpenJob && { key: "job", label: "Open job", group: "organise", icon: ExternalLink, onSelect: ctx.onOpenJob },
    ]),
  };
}

export interface PlannerBulkInput {
  /** Statuses of the ticked calls (grid). */
  statuses: readonly (string | null | undefined)[];
  /** People `Offer to suggested` would offer across the ticked open calls. */
  suggested: number;
}

export interface PlannerBulkCtx {
  onOffer?: () => void;
  onConfirm?: () => void;
  onOfferSuggested?: () => void;
  onCancel?: () => void;
}

/** How many of the ticked calls each verb would change. */
export function plannerBulkCounts(statuses: readonly (string | null | undefined)[]) {
  const count = (v: "confirm" | "cancel") => statuses.filter((s) => canCrewCall(s, v)).length;
  // A bulk Offer sends only to calls still waiting on one (a resend is a per-call ⋯ verb).
  return { offer: statuses.filter((s) => (s ?? "PENDING") === "PENDING").length, confirm: count("confirm"), cancel: count("cancel") };
}

/**
 * `Offer 3 · Confirm 2 · Offer to suggested 2 · Cancel 4` (§9h.3). Each label
 * carries the number of calls it would change; a verb that would change none
 * is absent. Cancel is red, last and confirmed.
 */
export function buildPlannerBulkActions(input: PlannerBulkInput, ctx: PlannerBulkCtx): BulkAction[] {
  const n = plannerBulkCounts(input.statuses);
  const cancelStatuses = input.statuses.filter((s) => canCrewCall(s, "cancel"));
  const out: (BulkAction | false | undefined)[] = [
    !!ctx.onOffer && n.offer > 0 && { key: "offer", label: () => `Offer ${n.offer}`, group: "edit", icon: Send, onSelect: ctx.onOffer, confirm: offerConfirm(n.offer) },
    !!ctx.onConfirm && n.confirm > 0 && { key: "confirm", label: () => `Confirm ${n.confirm}`, group: "edit", icon: CalendarCheck, onSelect: ctx.onConfirm },
    !!ctx.onOfferSuggested && input.suggested > 0 && {
      key: "suggested", label: () => `Offer to suggested ${input.suggested}`, group: "edit", icon: Users, onSelect: ctx.onOfferSuggested, confirm: offerConfirm(input.suggested),
    },
    !!ctx.onCancel && n.cancel > 0 && {
      key: "cancel", label: () => `Cancel ${n.cancel}`, group: "danger", icon: Ban, danger: true, onSelect: ctx.onCancel, confirm: cancelConfirm(cancelStatuses),
    },
  ];
  return out.filter((a): a is BulkAction => !!a);
}
