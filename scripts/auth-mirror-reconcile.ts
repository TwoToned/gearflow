/**
 * Auth-mirror RECONCILE + drift monitor (tier-0 — the Convex user/member mirror is
 * the AUTHORIZATION source of truth: `requireOrgPermission` resolves a caller's role
 * from the Convex `members` mirror row, NOT the JWT). The live sync is best-effort
 * fire-and-forget; this job is the backstop referenced in member-mirror.ts.
 *
 * Unlike the `convex-backfill-*` scripts (which only createIfMissing → they can't fix
 * a drifted role or delete a stale grant), this FULLY reconciles Postgres → Convex:
 *
 *   • MEMBERS (authZ-critical):
 *       - missing in Convex        → create the mirror row
 *       - role / org / user drift  → overwrite the mirror row (upsert = replace)
 *       - ORPHAN (Convex row whose Better-Auth member is gone) → DELETE it
 *         (a stale mirror member = a stale authZ grant → privilege that outlives removal)
 *   • USERS: missing/drift → re-mirror (upsert-replace); orphan → delete.
 *
 * Drift monitoring: prints a structured summary, records the run to Convex, and — if
 * any drift was found (i.e. the live sync had failed) — emails an alert (when
 * RECONCILE_ALERT_EMAIL is set) and exits NON-ZERO so the cron surfaces it. A clean
 * steady-state run prints "0 drift" and exits 0.
 *
 * Runs where BOTH prod Postgres and prod Convex are reachable — i.e. INSIDE the app
 * container (Postgres is not reachable from GitHub Actions). See ops/auth-mirror-reconcile.
 *
 *   docker exec <app> npx tsx scripts/auth-mirror-reconcile.ts
 */
import { prisma } from "@/lib/prisma";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";
import { mirrorUserToConvex, removeUserFromConvex } from "@/lib/user-mirror";
import { upsertMemberMirror } from "@/lib/member-mirror";
import { sendEmail } from "@/lib/email";
import { env } from "@/env";

type Counts = { checked: number; created: number; updated: number; orphansRemoved: number };
const zero = (): Counts => ({ checked: 0, created: 0, updated: 0, orphansRemoved: 0 });

async function main() {
  const startedAt = new Date();
  const users = zero();
  const members = zero();
  const notes: string[] = [];

  // ── USERS ──────────────────────────────────────────────────────────────────
  const [pgUsers, cvxUsers] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true, name: true } }),
    (await getConvexClient()).query(api.users.listAll, {}),
  ]);
  users.checked = pgUsers.length;
  const cvxUserById = new Map(cvxUsers.map((u) => [u.id, u]));
  const pgUserIds = new Set(pgUsers.map((u) => u.id));

  for (const u of pgUsers) {
    const cvx = cvxUserById.get(u.id);
    if (!cvx) {
      await mirrorUserToConvex(u.id);
      users.created++;
      notes.push(`user +${u.id} (${u.email})`);
    } else if ((cvx.email ?? null) !== (u.email ?? null) || (cvx.name ?? null) !== (u.name ?? null)) {
      await mirrorUserToConvex(u.id);
      users.updated++;
      notes.push(`user ~${u.id} (email/name drift)`);
    }
  }
  for (const cvx of cvxUsers) {
    if (!pgUserIds.has(cvx.id)) {
      await removeUserFromConvex(cvx.id);
      users.orphansRemoved++;
      notes.push(`user -${cvx.id} (ORPHAN removed)`);
    }
  }

  // ── MEMBERS (authZ-critical) ─────────────────────────────────────────────────
  const [pgMembers, cvxMembers] = await Promise.all([
    prisma.member.findMany({
      select: { id: true, organizationId: true, userId: true, role: true, createdAt: true },
    }),
    (await getConvexClient()).query(api.members.listAll, {}),
  ]);
  members.checked = pgMembers.length;
  const cvxMemberById = new Map(cvxMembers.map((m) => [m.id, m]));
  const pgMemberIds = new Set(pgMembers.map((m) => m.id));

  for (const m of pgMembers) {
    const cvx = cvxMemberById.get(m.id);
    if (!cvx) {
      await upsertMemberMirror(m);
      members.created++;
      notes.push(`member +${m.id} (${m.role})`);
    } else if (
      cvx.role !== m.role ||
      cvx.organizationId !== m.organizationId ||
      cvx.userId !== m.userId
    ) {
      // authZ-critical: a drifted role silently mis-authorizes the user.
      await upsertMemberMirror(m);
      members.updated++;
      notes.push(`member ~${m.id} (role ${cvx.role}→${m.role})`);
    }
  }
  const convex = await getConvexClient();
  for (const cvx of cvxMembers) {
    if (!pgMemberIds.has(cvx.id)) {
      // ORPHAN grant — the Better-Auth member is gone but the mirror still grants
      // this role. Remove it (fail-closed).
      await convex.mutation(api.members.remove, { id: cvx.id });
      members.orphansRemoved++;
      notes.push(`member -${cvx.id} (ORPHAN grant removed: ${cvx.role})`);
    }
  }

  // ── Post-reconcile parity ────────────────────────────────────────────────────
  const [cvxUsers2, cvxMembers2] = await Promise.all([
    convex.query(api.users.listAll, {}),
    convex.query(api.members.listAll, {}),
  ]);
  const parityOk =
    cvxUsers2.length === pgUsers.length && cvxMembers2.length === pgMembers.length;

  const userDrift = users.created + users.updated + users.orphansRemoved;
  const memberDrift = members.created + members.updated + members.orphansRemoved;
  const totalDrift = userDrift + memberDrift;

  const summary = {
    ranAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    users,
    members,
    parity: {
      ok: parityOk,
      pgUsers: pgUsers.length,
      cvxUsers: cvxUsers2.length,
      pgMembers: pgMembers.length,
      cvxMembers: cvxMembers2.length,
    },
    totalDrift,
    notes,
  };
  console.log(JSON.stringify(summary, null, 2));

  // ── Alert on drift (the live sync had failed) or a hard parity break ──────────
  const alertTo = process.env.RECONCILE_ALERT_EMAIL;
  if ((totalDrift > 0 || !parityOk) && alertTo) {
    await sendEmail({
      to: alertTo,
      subject: `[${env.PLATFORM_NAME}] auth-mirror drift: ${totalDrift} corrected${parityOk ? "" : " — PARITY BREAK"}`,
      html: `<pre>${JSON.stringify(summary, null, 2)}</pre>`,
    }).catch((e) => console.error("[reconcile] alert email failed:", e));
  }

  await prisma.$disconnect();

  if (!parityOk) {
    console.error("RECONCILE FAILED: post-reconcile parity mismatch.");
    process.exit(2);
  }
  if (totalDrift > 0) {
    console.error(`RECONCILE: ${totalDrift} drift item(s) detected + corrected (live sync had lagged).`);
    process.exit(1);
  }
  console.log("RECONCILE OK: mirror in sync, 0 drift.");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(3);
});
