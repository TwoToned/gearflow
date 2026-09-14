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

interface DormantOrgCandidate {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  dormancyStage: number | null;
  members: { user: { email: string } }[];
}

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

  await prisma.organization.update({
    where: { id: org.id },
    data: { dormancyStage: stage, dormancyNoticedAt: new Date() },
  });
  await sendEmail({ to: owner.email, ...content });
}

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
  await sendEmail({
    to: owner.email,
    ...dormancyArchivedEmail({ orgName: org.name, reactivateUrl, platformName }),
  });
}

/** One sweep tick: scan a bounded page of never-archived orgs old enough for
 *  the earliest ladder stage, re-derive "never activated" fresh for each
 *  (never trusting a stored flag), and advance/send whichever single stage
 *  is now due. Two Convex round trips total (batched milestone/activity
 *  stats + nothing else) regardless of how many orgs are scanned — never
 *  N+1, matching `enrichOrgsWithConvexStats`'s own established pattern. */
export async function runOrgDormancySweep(): Promise<{ scanned: number; emailed: number; archived: number }> {
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
    const orgStats = statsByOrg.get(org.id);
    if (!orgStats || !isStillNeverActivated(org._count.members, orgStats)) continue;

    const daysSinceCreation = Math.floor((Date.now() - org.createdAt.getTime()) / DAY_MS);
    const nextStage = nextDormancyStage(org.dormancyStage ?? 0, daysSinceCreation);
    if (nextStage === null) continue;

    if (nextStage === STAGE_DAY30_ARCHIVED) {
      await archiveDormantOrg(org, platformName);
      archived++;
    } else {
      await sendLadderStageEmail(org, nextStage, platformName);
    }
    emailed++;
  }

  return { scanned: candidates.length, emailed, archived };
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
