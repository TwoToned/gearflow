import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isPastValidUntil } from "./quoteDates";

/**
 * Quote revision state — the shared read model behind the five verbs
 * (`convex/quotesWrites.ts`), the acceptance gate on `CONFIRMED`
 * (`convex/projectWrites.ts`) and the Finance tab queries (`convex/quotes.ts`).
 * #986, Phase A of the finance version-control program.
 *
 * Two rules are encoded here once so nothing re-derives them:
 *
 * 1. **`EXPIRED` is derived on read**, never stored — `validUntil < now &&
 *    status === "SENT"`. No cron, no clock skew, no stale row (same precedent as
 *    FEATUREDOCS/66's derived readiness chips). Everything that branches on
 *    "is this quote still live" MUST go through `effectiveQuoteStatus`.
 * 2. **`PUBLISHED` reads as `SENT`.** It is the deprecated pre-#986 value;
 *    `backfillQuoteRevisions.ts` rewrites it, but readers normalise on the way
 *    out so behaviour is identical before, during and after the migration.
 *
 * ⚠️ R-8.4.3: `quotes.by_cuid` and `by_projectId` are GLOBAL Convex indexes and
 * `requireOrgRead`/`requireOrgPermission` authorise the CALLER's org, not the
 * ROW's. Every loader in this file re-checks `organizationId` — use them rather
 * than querying the table directly.
 */

/** The vocabulary a reader ever sees. `PUBLISHED` is normalised away; `EXPIRED`
 *  is only ever produced here, never persisted. */
export type EffectiveQuoteStatus =
  | "DRAFT"
  | "SENT"
  | "ACCEPTED"
  | "DECLINED"
  | "SUPERSEDED"
  | "EXPIRED";

/** Statuses that represent a document the client is currently holding — the ones
 *  `sendNative` supersedes when the next revision goes out, and the ones that
 *  block cutting a second draft. */
const LIVE_STATUSES: ReadonlySet<EffectiveQuoteStatus> = new Set<EffectiveQuoteStatus>([
  "SENT",
  "ACCEPTED",
  "EXPIRED",
]);

/** Map a STORED status onto the post-#986 vocabulary. Only `PUBLISHED` moves. */
export function normalizeStoredQuoteStatus(status: string): EffectiveQuoteStatus {
  return (status === "PUBLISHED" ? "SENT" : status) as EffectiveQuoteStatus;
}

/**
 * The status a reader should act on: the stored one, normalised, with `SENT`
 * rendered as `EXPIRED` once `validUntil` has passed. An expired revision blocks
 * acceptance until it is explicitly re-sent — that's the whole point of stamping
 * `validUntil` at send instead of recomputing it at render time.
 */
export function effectiveQuoteStatus(
  quote: Pick<Doc<"quotes">, "status" | "validUntil">,
  nowMs: number,
): EffectiveQuoteStatus {
  const status = normalizeStoredQuoteStatus(quote.status);
  if (status === "SENT" && isPastValidUntil(quote.validUntil, nowMs)) return "EXPIRED";
  return status;
}

/** True when this revision is the document the client currently holds (sent,
 *  accepted, or sent-and-since-expired). */
export function isLiveQuoteStatus(status: EffectiveQuoteStatus): boolean {
  return LIVE_STATUSES.has(status);
}

/** A project's revision number — the ALLOCATOR, the highest version number
 *  ever handed out (#1080/#1085). Absent ⇒ 1 — pre-#986 documents and any row
 *  the backfill hasn't reached read as v1 rather than `undefined` leaking into
 *  arithmetic (R-3.1: ONE coalesce, not one per call site). */
export function projectRevision(project: Pick<Doc<"projects">, "revision">): number {
  const revision = project.revision;
  return typeof revision === "number" && Number.isFinite(revision) && revision >= 1
    ? Math.floor(revision)
    : 1;
}

/** A project's LIVE revision — the version currently projected onto the live
 *  tables (#1080/#1085). Absent ⇒ `revision` (every pre-#1085 project — the
 *  two numbers were the same field until this split). This is the number
 *  Save version / New version bump together with `revision`; only a Phase 2
 *  promote can point it at an OLDER number than `revision`. R-3.1: ONE
 *  coalesce, not one per call site — always read the live revision through
 *  this, never `project.liveRevision` directly. */
export function projectLiveRevision(project: Pick<Doc<"projects">, "revision" | "liveRevision">): number {
  const liveRevision = project.liveRevision;
  return typeof liveRevision === "number" && Number.isFinite(liveRevision) && liveRevision >= 1
    ? Math.floor(liveRevision)
    : projectRevision(project);
}

/** Every quote row for a project, org-checked (`by_projectId` is global). */
export async function listProjectQuotes(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
): Promise<Doc<"quotes">[]> {
  const rows = await ctx.db
    .query("quotes")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  return rows.filter((r) => r.organizationId === orgId);
}

/** The single quote row at `(projectId, revision)`, org-checked. The "exactly one
 *  row per revision" invariant makes this unambiguous; a second row at the same
 *  revision is a bug, and this returns the first deterministically rather than
 *  throwing, so a corrupted project stays readable. The org check is pushed into
 *  the query so the read stays a point lookup on `by_projectId_version` rather
 *  than a `.collect()` of the (already tiny) range. */
export async function findQuoteAtRevision(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  revision: number,
): Promise<Doc<"quotes"> | null> {
  return await ctx.db
    .query("quotes")
    .withIndex("by_projectId_version", (q) => q.eq("projectId", projectId).eq("version", revision))
    .filter((q) => q.eq(q.field("organizationId"), orgId))
    .first();
}

/** The revision the client is currently holding — the one `SENT`/`ACCEPTED` (or
 *  since-expired) row. Null when nothing has been sent yet. */
export async function findLiveQuote(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  nowMs: number,
): Promise<Doc<"quotes"> | null> {
  const quotes = await listProjectQuotes(ctx, orgId, projectId);
  return quotes.find((q) => isLiveQuoteStatus(effectiveQuoteStatus(q, nowMs))) ?? null;
}

/**
 * Whether this project has an accepted quote revision — the gate on advancing to
 * `CONFIRMED` (decision 3). Only the CURRENT document counts: sending a new
 * revision supersedes the accepted one, so a project whose pricing changed after
 * acceptance has to get the new revision accepted (or be overridden) before it
 * can confirm again.
 */
export async function hasAcceptedQuote(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  nowMs: number,
): Promise<boolean> {
  const quotes = await listProjectQuotes(ctx, orgId, projectId);
  return quotes.some((q) => effectiveQuoteStatus(q, nowMs) === "ACCEPTED");
}

/** Load a quote by its cuid and assert it belongs to `orgId` (R-8.4.3 — `by_cuid`
 *  is global). Throws `NOT_FOUND` for both "missing" and "another org's", so a
 *  cross-tenant probe can't distinguish the two. */
export async function requireQuoteInOrg(
  ctx: QueryCtx | MutationCtx,
  quoteId: string,
  orgId: string,
): Promise<Doc<"quotes">> {
  const quote = await ctx.db.query("quotes").withIndex("by_cuid", (q) => q.eq("id", quoteId)).first();
  if (!quote || quote.organizationId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found." });
  }
  return quote;
}

/** Load a project by its cuid and assert it belongs to `orgId` (`by_cuid` is
 *  global). Shared by every quote mutation so the check can't be forgotten. */
export async function requireProjectInOrg(
  ctx: QueryCtx | MutationCtx,
  projectId: string,
  orgId: string,
): Promise<Doc<"projects">> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (!project || project.organizationId !== orgId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
  }
  return project;
}

/**
 * The quote at the project's CURRENT revision, normalised, with NO time-based
 * `EXPIRED` resolution — #988 (Phase C)'s `resolveLockTier` treats `SENT` and
 * `EXPIRED` identically (both are "sent and not yet superseded by a new
 * version"), so distinguishing them isn't needed to gate a write. That in turn
 * means `assertLifecycleGuard` doesn't need a `now` argument threaded through
 * the ~25 existing gate sites that call it — none of them pass one today.
 * Null when no row exists at this revision yet (a project that has never
 * quoted, or a fresh `DRAFT` created by `newVersionNative`) — reads exactly
 * like a `DRAFT` for lock purposes.
 */
export async function currentRevisionQuoteStatus(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  projectId: string,
  revision: number,
): Promise<EffectiveQuoteStatus | null> {
  const quote = await findQuoteAtRevision(ctx, orgId, projectId, revision);
  return quote ? normalizeStoredQuoteStatus(quote.status) : null;
}

/** Human label for a revision — `<projectNumber> v<version>`. There is
 *  deliberately no quote number (decision 5): the project number is already the
 *  shared reference with the client, and a second counter would be one more
 *  surface to keep in sync. Used in audit summaries and, later, PDF headers. */
export function quoteLabel(projectNumber: string, version: number): string {
  return `${projectNumber} v${version}`;
}

/**
 * Strictly org OWNER — one tier above `isHardLockOverrideAllowed`
 * (`projectLocks.ts`, which also admits admins and the project's assigned
 * PM(s)). Reserved for the handful of quote actions where "a document a client
 * may already hold" is being permanently erased or protected from further
 * tampering (#1029/#1030): mutating something the client can no longer be
 * shown a corrected copy of deserves a strictly narrower audience than undoing
 * a lock. `hasPermission`'s "owner always passes" safety net (`permissionsCore.ts`)
 * makes a resource/action check unusable here — admins/managers can hold the
 * same `invoice:publish` grant, so only a direct role check is actually owner-only.
 */
export async function requireQuoteOwnerOnly(
  ctx: MutationCtx,
  orgId: string,
  userId: string,
  action: string,
): Promise<void> {
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", userId))
    .first();
  if (member?.role === "owner") return;
  throw new ConvexError({
    code: "FORBIDDEN_OWNER_ONLY",
    message: `Only an org owner can ${action} — this touches a document a client may already hold.`,
  });
}
