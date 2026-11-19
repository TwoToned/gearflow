/**
 * The floor's `Look up` result, decided ONCE (spec §9c.3): what a scanned or
 * typed value means and which card, if any, to ring. Pure, so the dock hook,
 * the tests and (later) Receive share one reading. The strip entry's tone,
 * text and target come from here; the hook only renders them.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { FloorJob } from "@/lib/warehouse-floor";

export type ScanResolve = FunctionReturnType<typeof api.scanLookup.resolve>;

export interface LookupResult {
  tone: "info" | "warning" | "error";
  text: string;
  /** The card to ring and scroll to. */
  ringJobId: string | null;
  /** Where `Open` goes (the job's warehouse page, else the asset). */
  openHref: string | null;
}

const STATE_WORD = { to_pick: "to pick for", packed: "packed for", out: "out on" } as const;

/** `#2341`, `2341` or ` #2341 ` all name job 2341. */
export function jobByNumber(jobs: readonly FloorJob[], raw: string): FloorJob | null {
  const n = raw.trim().replace(/^#/, "").toLowerCase();
  if (!n) return null;
  return jobs.find((j) => j.projectNumber.toLowerCase() === n) ?? null;
}

export function jobLookup(job: FloorJob): LookupResult {
  return { tone: "info", text: `#${job.projectNumber} · ${job.name}`, ringJobId: job.id, openHref: `/warehouse/${job.id}` };
}

function guardResult(tag: string, guard: NonNullable<ScanResolve["guard"]>): LookupResult {
  const text = guard.kind === "kit_member"
    ? `${tag} is in kit ${guard.kitTag ?? "(unknown)"} · scan the kit`
    : `${tag} returns with its parent ${guard.parentTag ?? ""}`.trim();
  return { tone: "warning", text, ringJobId: null, openHref: null };
}

export function tagLookup(tag: string, res: ScanResolve, jobs: readonly FloorJob[]): LookupResult {
  if (res.guard) return guardResult(tag, res.guard);
  if (!res.url) return { tone: "error", text: `${tag} · not a gear tag`, ringJobId: null, openHref: null };
  const label = res.label ?? tag;
  if (res.activity.length === 0) return { tone: "info", text: `${label} · not on a job`, ringJobId: null, openHref: res.url };
  if (res.activity.length > 1) {
    const where = [...new Set(res.activity.map((a) => `#${a.projectNumber}`))].join(", ");
    return { tone: "info", text: `${label} · on ${where}`, ringJobId: res.activity[0].projectId, openHref: res.url };
  }
  const a = res.activity[0];
  const onBoard = jobs.some((j) => j.id === a.projectId);
  return {
    tone: "info",
    text: `${label} · ${STATE_WORD[a.state]} #${a.projectNumber}`,
    ringJobId: onBoard ? a.projectId : null,
    openHref: `/warehouse/${a.projectId}`,
  };
}
