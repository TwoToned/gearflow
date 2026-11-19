import { ExternalLink, FileText, LayoutDashboard, PackageCheck, ShieldAlert, UserRound } from "lucide-react";

import type { ActionItem, ActionMenuSpec, BulkAction } from "@/lib/primitives/types";
import { isCloseable, type FloorJob } from "@/lib/warehouse-floor";
import { OUT_LABEL } from "@/lib/vocabulary";

/**
 * The floor card's ⋯ and the floor's bulk verbs (spec §9c.2, D6, D27). Pure:
 * every condition is decided here, and an action that does not apply is ABSENT
 * (never disabled). Close out and the Admin overrides have no reverse
 * mutation, so they confirm and offer no Undo (plan Q5, a prototype deviation).
 */

export type OverrideTarget = "CHECKED_OUT" | "RETURNED" | "COMPLETED";

/** The shape `warehouseHeaderProps({ overrides })` takes, so the warehouse job
 *  header and the floor card share ONE override list (D6). The job page wires
 *  it in build step 5; until then it is module-internal. */
interface AdminOverride {
  key: string;
  label: string;
  title: string;
  body: string;
  run: () => void | Promise<void>;
}

type OverrideJob = Pick<FloorJob, "status" | "counts">;

const OUTISH = new Set(["CHECKED_OUT", "ON_SITE"]);
const PAST_OUT = new Set(["CHECKED_OUT", "ON_SITE", "RETURNED", "COMPLETED"]);

const units = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

function overrideTargets(status: string): OverrideTarget[] {
  const t: OverrideTarget[] = [];
  if (!PAST_OUT.has(status)) t.push("CHECKED_OUT");
  if (OUTISH.has(status)) t.push("RETURNED");
  if (OUTISH.has(status) || status === "RETURNED") t.push("COMPLETED");
  return t;
}

const WORD: Record<OverrideTarget, string> = { CHECKED_OUT: OUT_LABEL, RETURNED: "Returned", COMPLETED: "Completed" };

/** What the scanner disagrees with, in the words the old warning dialog used. */
function overrideBody(target: OverrideTarget, job: OverrideJob): string {
  const c = job.counts;
  const notOut = Math.max(0, c.items - c.out - c.back);
  if (target === "CHECKED_OUT" && notOut > 0) {
    return `${units(notOut)} not yet deployed. The job moves to ${WORD[target]} anyway; item state is not changed.`;
  }
  if (target !== "CHECKED_OUT" && c.out > 0) {
    return `${units(c.out)} not returned yet. The job moves to ${WORD[target]} anyway; item state is not changed.`;
  }
  return `The job moves to ${WORD[target]}. This cannot be undone from here.`;
}

/** Admin · ignores item state. Absent unless the user may check out. */
function adminOverrides(
  job: OverrideJob,
  ctx: { canCheckOut: boolean; setStatus: (target: OverrideTarget) => void | Promise<void> },
): AdminOverride[] {
  if (!ctx.canCheckOut) return [];
  return overrideTargets(job.status).map((target) => ({
    key: `override-${target}`,
    label: `Mark ${WORD[target].toLowerCase()}`,
    title: `Mark this job ${WORD[target]}?`,
    body: overrideBody(target, job),
    run: () => ctx.setStatus(target),
  }));
}

export type FloorDocType = "pull-slip" | "delivery-docket" | "return-sheet";

export interface FloorJobCtx {
  canCheckOut: boolean;
  canCloseOut: boolean;
  open: (href: string) => void;
  openDocument: (type: FloorDocType) => void;
  setStatus: (target: OverrideTarget) => void | Promise<void>;
  closeOut: () => void | Promise<void>;
  /** Opens the packer picker for this job; absent without `warehouse:check_out`. */
  assignPacker?: () => void;
}

const doc = (key: FloorDocType, label: string, ctx: FloorJobCtx): ActionItem => ({
  key, label, group: "documents", icon: FileText, onSelect: () => ctx.openDocument(key),
});

export function buildFloorJobActions(job: FloorJob, ctx: FloorJobCtx): ActionMenuSpec {
  const overrides = adminOverrides(job, ctx);
  const items: ActionItem[] = [
    { key: "open", label: "Open job", group: "organise", icon: ExternalLink, onSelect: () => ctx.open(`/warehouse/${job.id}`) },
    { key: "overview", label: "Job overview", group: "organise", icon: LayoutDashboard, onSelect: () => ctx.open(`/projects/${job.id}`) },
    ...(ctx.assignPacker ? [{ key: "packer", label: "Assign packer…", group: "organise" as const, icon: UserRound, onSelect: ctx.assignPacker }] : []),
    doc("pull-slip", "Pull slip", ctx),
    doc("delivery-docket", "Delivery docket", ctx),
    doc("return-sheet", "Return sheet", ctx),
  ];
  if (ctx.canCloseOut && isCloseable(job)) {
    items.push({
      key: "close-out", label: "Close out", group: "danger", danger: true, icon: PackageCheck, onSelect: ctx.closeOut,
      confirm: { title: `Close out #${job.projectNumber}?`, body: "Finishes the job's warehouse work. This cannot be undone from here.", confirmLabel: "Close out" },
    });
  }
  if (overrides.length > 0) {
    items.push({
      key: "admin", label: "Admin · ignores item state", group: "danger", icon: ShieldAlert, onSelect: () => {},
      children: overrides.map((o) => ({
        key: o.key, label: o.label, group: "danger", danger: true, onSelect: o.run,
        confirm: { title: o.title, body: o.body, confirmLabel: o.label },
      })),
    });
  }
  return { items };
}

/** The server caps a batch close-out at 25 jobs. */
const CLOSE_OUT_CAP = 25;

/** Bulk verbs over the ticked cards. `Close out n` counts only closeable jobs. */
export function buildFloorBulkActions(
  jobs: readonly FloorJob[],
  ctx: { canCloseOut: boolean; closeOut: (ids: string[]) => void | Promise<void>; assignPacker?: (ids: string[]) => void },
): BulkAction[] {
  const packer: BulkAction[] = ctx.assignPacker && jobs.length > 0
    ? [{ key: "packer", label: (n) => `Assign packer… ${n}`, group: "organise", icon: UserRound, onSelect: () => ctx.assignPacker!(jobs.map((j) => j.id)) }]
    : [];
  const closeable = jobs.filter(isCloseable).slice(0, CLOSE_OUT_CAP);
  if (!ctx.canCloseOut || closeable.length === 0) return packer;
  const n = closeable.length;
  return [...packer, {
    key: "close-out", label: () => `Close out ${n}`, group: "danger", danger: true, icon: PackageCheck,
    onSelect: () => ctx.closeOut(closeable.map((j) => j.id)),
    confirm: {
      title: `Close out ${n} job${n === 1 ? "" : "s"}?`,
      body: `${jobs.length > n ? `Only returned jobs close out (${n} of ${jobs.length}). ` : ""}This finishes their warehouse work and cannot be undone from here.`,
      confirmLabel: "Close out",
    },
  }];
}
