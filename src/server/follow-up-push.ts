"use server";

/**
 * Follow-up automation — the urgent phone push (design D3, FEATUREDOCS/82).
 * Only URGENT follow-ups (a quote decision or a deposit whose event is under a
 * week away) buzz a phone; everything else waits for the morning brief and the
 * dashboard. Rationed in `convex/followUpPush.ts` `claimPush`: one push per
 * follow-up rung, at most `FOLLOW_UP_PUSH_DAILY_CAP` per person per local day,
 * never in quiet hours (19:00–07:00 org time).
 *
 * Rides the notification cron; inert unless the VAPID keys are configured.
 * Cron-only, no session — never import this from a client component.
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { env } from "@/env";
import { readOrgSettingsBlob } from "@/lib/org-settings-read";
import { endOfDayInTimezone } from "@/lib/quote-validity";
import { sendWebPush, type VapidIdentity } from "@/lib/web-push";
import { FOLLOW_UP_PUSH_DAILY_CAP, isPushWindow, localClock, pushKeys, pushPayload, urgentPushRows, type BriefRow } from "@/lib/follow-up-brief";

export interface FollowUpPushResult {
  pushed: number;
  skipped: number;
  errors: string[];
}

function vapidIdentity(): VapidIdentity | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

async function pushToDevices(orgId: string, row: BriefRow, keys: VapidIdentity, result: FollowUpPushResult): Promise<void> {
  const convex = await getConvexClient();
  const devices = await convex.query(api.followUpPush.subscriptionsForUser, { orgId, userId: row.assigneeUserId });
  for (const device of devices) {
    try {
      const res = await sendWebPush(device, pushPayload(row), keys, { urgency: "high", topic: `fu${row.id}` });
      if (res.gone) await convex.mutation(api.followUpPush.removeGoneSubscription, { orgId, endpoint: device.endpoint });
      else if (!res.ok) result.errors.push(`push ${res.status}`);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
}

async function pushOrg(orgId: string, keys: VapidIdentity, now: number, result: FollowUpPushResult): Promise<void> {
  const settings = await readOrgSettingsBlob(orgId);
  if (!settings.timezone || !isPushWindow(now, settings.timezone)) return;
  const convex = await getConvexClient();
  const rows = urgentPushRows(await convex.query(api.followUpTick.briefForOrg, { orgId, dueBy: endOfDayInTimezone(now, settings.timezone) }));
  const { dateKey } = localClock(now, settings.timezone);
  for (const row of rows) {
    const { itemKey, dayKey } = pushKeys(orgId, row, dateKey);
    const { claimed } = await convex.mutation(api.followUpPush.claimPush, {
      orgId, userId: row.assigneeUserId, itemKey, dayKey, cap: FOLLOW_UP_PUSH_DAILY_CAP, now,
    });
    if (!claimed) { result.skipped++; continue; }
    await pushToDevices(orgId, row, keys, result);
    result.pushed++;
  }
}

export async function sendUrgentFollowUpPushes(): Promise<FollowUpPushResult> {
  const result: FollowUpPushResult = { pushed: 0, skipped: 0, errors: [] };
  const keys = vapidIdentity();
  if (!keys) return result;
  const now = Date.now();
  const orgs = await prisma.organization.findMany({ where: { archivedAt: null }, select: { id: true } });
  for (const org of orgs) {
    try {
      await pushOrg(org.id, keys, now, result);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return result;
}
