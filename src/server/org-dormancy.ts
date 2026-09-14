"use server";

import crypto from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  dormancyArchivedEmail,
  dormancyArchiveWarningEmail,
  dormancyFinalWarningEmail,
  dormancyNudgeEmail,
  type EmailContent,
} from "@/lib/email-templates";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { getPlatformName } from "@/lib/platform";
import { env } from "@/env";
import { logActivity } from "@/lib/activity-log";
import { logger } from "@/lib/logger";
import {
  DAY_MS,
  STAGE_DAY23_WARNING,
  STAGE_DAY29_FINAL_WARNING,
  STAGE_DAY30_ARCHIVED,
  isStillNeverActivated,
  nextDormancyStage,
} from "@/lib/org-dormancy-stages";

/**
 * B4 (#1096) — the "never activated" email ladder's daily sweep. Design doc
 * §5.4 (D10, D13). Invoked by `POST /api/cron/org-dormancy`, itself invoked
 * by `convex/scheduledJobs.ts`'s `runOrgDormancySweep` internalAction on
 * `convex/crons.ts`'s daily schedule.
 *
 * The ELIGIBILITY predicate ("never activated") is fully derived and
 * re-checked fresh every tick — this module stores nothing that could go
 * stale into a false positive. `dormancyStage`/`dormancyNoticedAt` only
 * record the OUTBOUND SIDE EFFECT ("did we already email them"), which
 * cannot be derived from anything else: without a marker the cron would
 * re-send the same stage every day it runs. Any qualifying activity (a
 * single model/asset/project, ever) makes the predicate fail on the very
 * next tick — there's no explicit "cancel", the ladder just stops advancing
 * and the stored stage becomes irrelevant.
 */

// Bounded per tick — same discipline as convex/apiRequestLog.ts's
// purgeOlderThan capping at 2000 rows: a large backlog just takes a few
// extra days to fully drain (oldest-created first) rather than risking one
// sweep's read/time budget.
const MAX_ORGS_PER_TICK = 500;

// Postgres advisory lock key for the whole sweep tick. A tick that overruns
// into the next scheduled fire (or a manual POST /api/cron/org-dormancy
// overlapping the cron) would otherwise race: two concurrent runs can read
// the same org's dormancyStage, both decide to archive it, and each mint
// their own reactivation token — whichever write lands second silently
// invalidates the token already emailed by the first. Serializing the whole
// tick behind one lock (held for the duration, released in `finally`) makes
// a second concurrent invocation a no-op instead of a race. Arbitrary
// constant, unique to this feature — advisory locks are a flat namespace.
const SWEEP_LOCK_KEY = 1096_030;

interface DormantOrgCandidate {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  dormancyStage: number | null;
  members: { user: { email: string } }[];
  _count: { members: number };
}

/**
 * Send FIRST, persist the stage SECOND — this stage marker means nothing but
 * "we emailed them," so persisting it before the send succeeds would record
 * a stage as sent when it wasn't, and (since `nextDormancyStage` only fires
 * once `stage > currentStage`) permanently skip retrying it. If `sendEmail`
 * throws (it retries internally, then re-throws — see src/lib/email.ts), the
 * stage is simply left unadvanced for the next tick to retry.
 */
async function sendLadderStageEmail(
  org: DormantOrgCandidate,
  stage: number,
  platformName: string,
): Promise<void> {
  const owner = org.members[0]?.user;
  if (!owner?.email) {
    logger.warn("[org-dormancy] never-activated org has no owner to email — skipping", { organizationId: org.id });
    return;
  }
  const checklistUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard`;
  const content: EmailContent =
    stage === STAGE_DAY29_FINAL_WARNING
      ? dormancyFinalWarningEmail({ orgName: org.name, checklistUrl, platformName })
      : stage === STAGE_DAY23_WARNING
        ? dormancyArchiveWarningEmail({ orgName: org.name, checklistUrl, platformName })
        : dormancyNudgeEmail({ orgName: org.name, checklistUrl, platformName });

  await sendEmail({ to: owner.email, ...content });
  await prisma.organization.update({
    where: { id: org.id },
    data: { dormancyStage: stage, dormancyNoticedAt: new Date() },
  });
}

/**
 * Archiving itself (unlike the ladder emails) is the real action, not just a
 * notification — it must happen whether or not the owner can be reached, so
 * the write stays first. Only the reactivation email is best-effort from
 * here: a failure to send it is caught and logged rather than thrown, so it
 * can't undo the archive or abort the rest of the tick (the caller in
 * `runOrgDormancySweep` also isolates per-org failures, but this keeps the
 * "archive succeeded, email didn't" case explicit rather than relying on
 * that outer catch alone). The token is still persisted even if the send
 * fails, so a site admin can hand it to the owner out of band.
 */
async function archiveDormantOrg(org: DormantOrgCandidate, platformName: string): Promise<void> {
  const owner = org.members[0]?.user;
  const token = crypto.randomBytes(24).toString("hex");
  // Same slug-release move as adminArchiveOrganization (site-admin.ts) — a
  // new org can claim the original slug while this one stays archived.
  const archivedSlug = `${org.slug}-archived-${createId()}`;

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      archivedAt: new Date(),
      slug: archivedSlug,
      dormancyStage: STAGE_DAY30_ARCHIVED,
      dormancyNoticedAt: new Date(),
      dormancyReactivationToken: token,
    },
  });

  await logActivity({
    organizationId: org.id,
    userId: "system",
    userName: "Dormancy sweep",
    action: "UPDATE",
    entityType: "organization",
    entityId: org.id,
    entityName: org.name,
    summary: `Archived organization ${org.name} — never activated in 30 days`,
  });

  if (!owner?.email) {
    logger.warn("[org-dormancy] archived a never-activated org with no owner to email", { organizationId: org.id });
    return;
  }
  const reactivateUrl = `${env.NEXT_PUBLIC_APP_URL}/reactivate/${token}`;
  try {
    await sendEmail({
      to: owner.email,
      ...dormancyArchivedEmail({ orgName: org.name, reactivateUrl, platformName }),
    });
  } catch (err) {
    logger.error("[org-dormancy] archived an org but failed to send the reactivation email", {
      organizationId: org.id,
      error: err,
    });
  }
}

/** Evaluates and, if due, acts on a single candidate. Pulled out of
 *  `runOrgDormancySweep`'s loop so that function stays a plain orchestration
 *  shell — the per-candidate try/catch lives at the call site. */
async function processDormancyCandidate(
  org: DormantOrgCandidate,
  orgStats: { lastActivityAt: number | null; hasAnyMilestone: boolean } | undefined,
  platformName: string,
): Promise<"archived" | "emailed" | "skipped"> {
  if (!orgStats || !isStillNeverActivated(org._count.members, orgStats)) return "skipped";

  const daysSinceCreation = Math.floor((Date.now() - org.createdAt.getTime()) / DAY_MS);
  const nextStage = nextDormancyStage(org.dormancyStage ?? 0, daysSinceCreation);
  if (nextStage === null) return "skipped";

  if (nextStage === STAGE_DAY30_ARCHIVED) {
    await archiveDormantOrg(org, platformName);
    return "archived";
  }
  await sendLadderStageEmail(org, nextStage, platformName);
  return "emailed";
}

/** One sweep tick: scan a bounded page of never-archived orgs old enough for
 *  the earliest ladder stage, re-derive "never activated" fresh for each
 *  (never trusting a stored flag), and advance/send whichever single stage
 *  is now due. Two Convex round trips total (batched milestone/activity
 *  stats + nothing else) regardless of how many orgs are scanned — never
 *  N+1, matching `enrichOrgsWithConvexStats`'s own established pattern.
 *
 *  Holds a Postgres advisory lock for the whole tick (see `SWEEP_LOCK_KEY`)
 *  so an overrunning tick and the next scheduled fire — or a manual trigger
 *  overlapping the cron — can't run concurrently; a run that can't acquire
 *  the lock is a no-op, not a race. Each candidate's processing is isolated
 *  in its own try/catch so one org's failing email (e.g. a hard-bouncing
 *  address) can't abort the rest of the batch — every candidate behind it in
 *  `createdAt` order would otherwise be silently skipped every single tick,
 *  forever, since the same failing org always sorts first. */
export async function runOrgDormancySweep(): Promise<{ scanned: number; emailed: number; archived: number }> {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${SWEEP_LOCK_KEY}) AS locked
  `;
  if (!locked) {
    logger.warn("[org-dormancy] sweep already running — skipping this tick");
    return { scanned: 0, emailed: 0, archived: 0 };
  }

  try {
    const candidates = await prisma.organization.findMany({
      where: {
        archivedAt: null,
        // Nothing younger than the earliest stage (day 1) can ever be due —
        // narrows the Postgres scan itself, not just the in-memory filter.
        createdAt: { lte: new Date(Date.now() - DAY_MS) },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        dormancyStage: true,
        members: {
          where: { role: "owner" },
          take: 1,
          select: { user: { select: { email: true } } },
        },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "asc" }, // oldest (most overdue) first when bounded
      take: MAX_ORGS_PER_TICK,
    });

    if (candidates.length === 0) return { scanned: 0, emailed: 0, archived: 0 };

    const convex = await getConvexClient();
    const stats = await convex.query(api.orgAdminStats.getBatchOrgStats, {
      organizationIds: candidates.map((o) => o.id),
    });
    const statsByOrg = new Map(stats.map((s) => [s.organizationId, s]));
    const platformName = await getPlatformName();

    let emailed = 0;
    let archived = 0;

    for (const org of candidates) {
      try {
        const outcome = await processDormancyCandidate(org, statsByOrg.get(org.id), platformName);
        if (outcome === "archived") archived++;
        if (outcome !== "skipped") emailed++;
      } catch (err) {
        logger.error("[org-dormancy] failed to process a candidate org — continuing with the rest of the batch", {
          organizationId: org.id,
          error: err,
        });
      }
    }

    return { scanned: candidates.length, emailed, archived };
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${SWEEP_LOCK_KEY})`;
  }
}

/**
 * Self-service reactivation (the link in `dormancyArchivedEmail`). Public —
 * no session required, since the whole point is recovering access to an org
 * whose only member may not currently be able to sign in to anything. The
 * token is single-use (cleared on success) and only ever matches an org that
 * is CURRENTLY archived, so a stale/already-used link fails closed rather
 * than silently no-opping on some other org state.
 *
 * Deliberately does NOT restore the pre-archive slug — same call
 * `adminUnarchiveOrganization` (site-admin.ts) makes, for the same reason:
 * another org may have claimed it in the meantime.
 */
export async function reactivateOrganizationByToken(
  token: string,
): Promise<{ ok: true; orgName: string } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Invalid reactivation link." };

  const org = await prisma.organization.findUnique({
    where: { dormancyReactivationToken: token },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!org || !org.archivedAt) {
    return { ok: false, error: "This reactivation link is invalid or has already been used." };
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      archivedAt: null,
      dormancyStage: null,
      dormancyNoticedAt: null,
      dormancyReactivationToken: null,
    },
  });

  await logActivity({
    organizationId: org.id,
    userId: "system",
    userName: "Dormancy sweep",
    action: "UPDATE",
    entityType: "organization",
    entityId: org.id,
    entityName: org.name,
    summary: `Reactivated organization ${org.name} via self-service link`,
  });

  return { ok: true, orgName: org.name };
}
