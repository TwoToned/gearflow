"use client";

import { toast } from "sonner";

import { useCrewAssignmentWrites } from "@/hooks/use-crew-assignment-writes";
import { keyOfMs, type OpenCall, type PlannerMember, type SuggestedOffer } from "@/lib/crew-planner";
import { announceListWrite, listWriteTitle } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { MAX_CREW_MAIL_BATCH } from "@/lib/validations/crew";
import { sendCancellationEmails, sendCrewOffers } from "@/server/crew-communication";

type MailSend = (input: { assignmentIds: string[] }) => Promise<MailResult>;

/**
 * Send crew mail in batches of at most `MAX_CREW_MAIL_BATCH` (the action's own
 * cap): a 150-call Cancel or a large Offer to suggested must email everyone,
 * not fail the whole send on the validator. Ids are deduped FIRST, so nobody
 * is mailed twice. A batch that throws stops the send: its ids and every later
 * one come back as `unsent` (with the error), and the batches already sent
 * stay counted — the caller offers Retry for exactly the rest.
 */
export async function mailInBatches(send: MailSend, ids: readonly string[]): Promise<MailResult & { unsent: string[] }> {
  const unique = [...new Set(ids)];
  const out = { sent: 0, errors: [] as string[], total: 0, unsent: [] as string[] };
  for (let i = 0; i < unique.length; i += MAX_CREW_MAIL_BATCH) {
    try {
      const r = await send({ assignmentIds: unique.slice(i, i + MAX_CREW_MAIL_BATCH) });
      out.sent += r.sent;
      out.total += r.total;
      out.errors.push(...r.errors);
    } catch (e) {
      out.unsent = unique.slice(i);
      out.errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }
  return out;
}

/**
 * Mail `ids`, then `report` what went. When a batch failed part-way, say so —
 * `40 sent, 110 not sent` — with Retry for exactly the unsent rest (S5 nit),
 * never a blanket failure that hides the 40 already out.
 */
async function mailWithRetry(
  send: MailSend,
  ids: readonly string[],
  report: (r: MailResult) => void,
  prefix = "",
  before: MailResult = { sent: 0, errors: [], total: 0 },
): Promise<void> {
  const r = await mailInBatches(send, ids);
  // A Retry carries what earlier attempts already sent: the toast reports the WHOLE send.
  const sofar: MailResult = { sent: before.sent + r.sent, total: before.total + r.total, errors: [...before.errors, ...r.errors] };
  if (r.unsent.length === 0) return report(sofar);
  const lastError = r.errors[r.errors.length - 1];
  const priorTotal = { ...sofar, errors: before.errors.concat(r.errors.slice(0, -1)) };
  toast.error(`${prefix}${sofar.sent} sent, ${r.unsent.length} not sent · ${lastError}`, {
    action: { label: "Retry", onClick: () => void mailWithRetry(send, r.unsent, report, prefix, priorTotal) },
  });
}

/**
 * Every planner write (UX Phase 15, §9h.3). Each is an existing mutation or
 * server action; nothing here decides who may do what — the server gates
 * every row and the toast names what it skipped.
 * - Offer a call → a PENDING call (`create`). With `Send the offer now` it is
 *   then offered (`sendCrewOffers`): the email is out, so no Undo. Saved as
 *   Pending, its Undo deletes the created call (only with `crew:delete`).
 * - Offer n / Offer to suggested n → `sendCrewOffers`: confirmed first, no Undo.
 * - Confirm n → `confirmMany`; its Undo is `unconfirmMany(result)`, the
 *   forward result passed through unchanged (ids + stamp only).
 * - Cancel n → `cancelMany`, then `sendCancellationEmails(toTell)`: confirmed
 *   first, no Undo.
 */
const calls = (n: number) => `${n} ${n === 1 ? "call" : "calls"}`;
const offers = (n: number) => `${n} ${n === 1 ? "offer" : "offers"}`;

export interface OfferCallInput {
  member: Pick<PlannerMember, "id" | "firstName" | "lastName">;
  open: OpenCall;
  crewRoleId: string;
  startTime: string;
  endTime: string;
  sendNow: boolean;
  /** The day the call was offered from; with `span: "day"` the call covers only it. */
  day: string;
  /** A multi-day service: this day only, or the whole run (a one-day service is the same either way). */
  span: "day" | "run";
}

/** The call's dates: the service's run, or just the picked day. */
function callDates(open: OpenCall, pick?: { day: string; span: "day" | "run" }): { startDate: string; endDate: string } {
  if (pick?.span === "day") return { startDate: pick.day, endDate: pick.day };
  return { startDate: dayKey(open.date), endDate: dayKey(open.endDate) || dayKey(open.date) };
}

export interface PlannerWriteCtx {
  /** `Ana Ruiz · #2341 Bump in`, for a skipped-row toast. */
  nameOf: (assignmentId: string) => string;
  canDelete: boolean;
}

type MailResult = { sent: number; errors: string[]; total: number };

/** `Sent 2 of 3 offers · Bob Ryan has no email address`. */
function mailTitle(r: MailResult, noun: (n: number) => string): string {
  const head = r.sent === r.total ? `${noun(r.sent)} sent` : `Sent ${r.sent} of ${noun(r.total)}`;
  return r.errors.length ? `${head} · ${r.errors.slice(0, 2).join("; ")}` : head;
}

function toastMail(r: MailResult, noun: (n: number) => string) {
  if (r.sent === 0 && r.total > 0) toast.error(mailTitle(r, noun));
  else toast.success(mailTitle(r, noun));
}

const dayKey = (ms: number | null | undefined): string => (ms != null ? keyOfMs(ms) : "");

export function usePlannerWrites(ctx: PlannerWriteCtx) {
  const asg = useCrewAssignmentWrites();

  /** A PENDING call on the open call's service, for this person (the whole run unless a day is picked). */
  async function createCall(
    open: OpenCall,
    memberId: string,
    f: { crewRoleId: string; startTime: string; endTime: string; day?: string; span?: "day" | "run"; dates?: { startDate: string; endDate: string } },
  ): Promise<string> {
    const { id } = await asg.create(open.projectId, {
      crewMemberId: memberId,
      crewRoleId: f.crewRoleId,
      serviceId: open.serviceId,
      status: "PENDING",
      phase: open.phase as "EVENT",
      isProjectManager: false,
      generateShifts: false,
      ...(f.dates ?? callDates(open, f.day && f.span ? { day: f.day, span: f.span } : undefined)),
      startTime: f.startTime,
      endTime: f.endTime,
    });
    return id;
  }

  /** The Offer a call sheet's submit. Resolves true when the sheet may close. */
  async function offerCall(input: OfferCallInput): Promise<boolean> {
    const who = `${input.member.firstName} ${input.member.lastName}`.trim();
    const what = `${input.open.projectNumber} ${input.open.title}`;
    let id: string;
    try {
      id = await createCall(input.open, input.member.id, input);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not add the call" });
      return false;
    }
    const undo = ctx.canDelete ? async () => void (await asg.remove(id)) : undefined;
    if (!input.sendNow) {
      announceListWrite({ title: `Saved ${who} as pending · ${what}`, undoneTitle: "Undone · call removed", performUndo: undo });
      return true;
    }
    try {
      const r = await sendCrewOffers({ assignmentIds: [id] });
      if (r.sent === 1) {
        toast.success(`Offered ${who} · ${what}`);
        return true;
      }
      // Not sent (no email, …): the call stays Pending, so it can still be taken back.
      announceListWrite({ title: `Saved ${who} as pending · ${r.errors[0] ?? "offer not sent"}`, undoneTitle: "Undone · call removed", performUndo: undo });
    } catch (e) {
      showError(e, { fallbackTitle: "The call was saved as pending, but the offer did not send" });
    }
    return true;
  }

  async function offer(ids: string[]) {
    await mailWithRetry(sendCrewOffers, ids, (r) => toastMail(r, offers));
  }

  async function confirm(ids: string[]) {
    let result: Awaited<ReturnType<typeof asg.confirmMany>>;
    try {
      result = await asg.confirmMany(ids);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not confirm" });
      return;
    }
    const skipped = result.skipped.map((id) => ({ name: ctx.nameOf(id), why: "still waiting on a yes" }));
    if (result.confirmed.length === 0) {
      toast.error(listWriteTitle("Nothing confirmed", skipped));
      return;
    }
    announceListWrite({
      title: listWriteTitle(`Confirmed ${calls(result.confirmed.length)}`, skipped),
      undoneTitle: `Undone · ${calls(result.confirmed.length)} back to Accepted`,
      performUndo: async () => {
        await asg.unconfirmMany(result);
      },
    });
  }

  /** Create each suggested call, then offer them all in one send. */
  async function offerSuggested(plan: { offers: SuggestedOffer[]; unfilled: OpenCall[] }) {
    const ids: string[] = [];
    const failed: string[] = [];
    for (const o of plan.offers) {
      try {
        // Exactly the days the suggestion checked (S2), never the rest of the run.
        const dates = { startDate: o.startDate, endDate: o.endDate };
        ids.push(await createCall(o.open, o.member.id, { crewRoleId: o.open.crewRoleId ?? "", startTime: o.open.startTime ?? "", endTime: o.open.endTime ?? "", dates }));
      } catch (e) {
        failed.push(`${o.member.firstName} ${o.member.lastName}: ${(e as Error).message}`);
      }
    }
    const short = plan.unfilled.length ? [`${calls(plan.unfilled.length)} had no one free`] : [];
    if (ids.length === 0) {
      toast.error(["No offers sent", ...failed, ...short].join(" · "));
      return;
    }
    await mailWithRetry(sendCrewOffers, ids, (r) => {
      const title = mailTitle({ ...r, errors: [...r.errors, ...failed] }, offers);
      toast.success(short.length ? `${title} · ${short[0]}` : title);
    });
  }

  async function cancel(ids: string[]) {
    let result: Awaited<ReturnType<typeof asg.cancelMany>>;
    try {
      result = await asg.cancelMany(ids);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not cancel" });
      return;
    }
    const skipped = result.skipped.map((id) => ({ name: ctx.nameOf(id), why: "already declined, completed or cancelled" }));
    const done = (told: string) => toast.success(listWriteTitle(`Cancelled ${calls(result.cancelled.length)} · the slots are open again${told}`, skipped));
    if (result.toTell.length === 0) return void done("");
    // The calls ARE cancelled; a failed mail batch says how many weren't told, with Retry.
    await mailWithRetry(
      sendCancellationEmails,
      result.toTell,
      (r) => done(` · ${r.sent} told by email${r.errors.length ? ` (${r.errors[0]})` : ""}`),
      `Cancelled ${calls(result.cancelled.length)} · cancellation emails: `,
    );
  }

  return { offerCall, offer, confirm, offerSuggested, cancel };
}
