import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Mirror of the Better-Auth `member` rows (source of truth
 * stays in Prisma) into their Convex mirror tables, so the native read layer's
 * `requireOrgPermission` guard can resolve a user's role + custom-role permissions
 * inside Convex.
 *
 * WRITE-ORDERING CONTRACT (§3.3.4) — Prisma and Convex can't share a transaction,
 * so the ORDER of the two writes decides the failure mode:
 *
 *   • RESTRICTIVE change (revoke / demote / permission-removal / role delete):
 *     write the MORE-restrictive state to Convex FIRST (strict — throws on
 *     failure), THEN commit Prisma. If Convex fails we abort before Prisma, so we
 *     can never end up Prisma-revoked-but-Convex-granting. A failed Convex write
 *     blocks the op (the caller retries) — temporary over-denial, never over-grant.
 *
 *   • ADDITIVE change (new member / promotion / new role): commit Prisma FIRST,
 *     mirror to Convex after (best-effort — swallows). A lagging/failed mirror
 *     denies too much, not too little — safe.
 *
 * The `strict` option selects the behaviour. The nightly reconcile is a backstop
 * for drift on the best-effort paths, NOT the primary control.
 *
 * NOTE: enforcement is not live until the browser cutover wires a composite onto
 * `requireOrgPermission`. Until then these writes only keep the mirror in sync;
 * the ordering is in place so the guarantee holds the moment a reader appears.
 */

function toMillis(d: Date | number | null | undefined): number | undefined {
  if (d == null) return undefined;
  return d instanceof Date ? d.getTime() : typeof d === "number" ? d : undefined;
}

type MirrorOpts = { strict?: boolean };

/** Run a Convex mirror write: strict ⇒ propagate failure (abort caller); else swallow. */
async function runMirror(
  label: string,
  fn: () => Promise<unknown>,
  opts: MirrorOpts | undefined,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (opts?.strict) {
      // Restrictive change: surface the failure so the caller aborts BEFORE the
      // Prisma write — never leave Convex granting what Prisma is about to revoke.
      throw err;
    }
    logger.error(`[member-mirror] ${label} failed (best-effort)`, { error: err });
  }
}

// ─── Members ────────────────────────────────────────────────────────────────

/** Upsert an explicit member row into the Convex mirror. */
export async function upsertMemberMirror(
  row: {
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt?: Date | number | null;
  },
  opts?: MirrorOpts,
): Promise<void> {
  await runMirror(
    `upsert member ${row.id}`,
    async () => {
      const convex = await getConvexClient();
      await convex.mutation(api.members.upsert, {
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        role: row.role,
        createdAt: toMillis(row.createdAt),
      });
    },
    opts,
  );
}

/** Read a member by id from Prisma and mirror it (additive — best-effort by default). */
export async function upsertMemberMirrorById(
  memberId: string,
  opts?: MirrorOpts,
): Promise<void> {
  const m = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, organizationId: true, userId: true, role: true, createdAt: true },
  });
  if (!m) return;
  await upsertMemberMirror(m, opts);
}

/** Read the member for (org, user) from Prisma and mirror it. Convenient for
 * provisioning paths that don't surface the member id (SSO, registration). */
export async function upsertMemberMirrorByOrgUser(
  organizationId: string,
  userId: string,
  opts?: MirrorOpts,
): Promise<void> {
  const m = await prisma.member.findFirst({
    where: { organizationId, userId },
    select: { id: true, organizationId: true, userId: true, role: true, createdAt: true },
  });
  if (!m) return;
  await upsertMemberMirror(m, opts);
}

/** Remove every mirrored member for (org, user) — revocation by membership. */
export async function removeMemberMirror(
  args: { organizationId: string; userId: string },
  opts?: MirrorOpts,
): Promise<void> {
  await runMirror(
    `remove member ${args.organizationId}/${args.userId}`,
    async () => {
      const convex = await getConvexClient();
      await convex.mutation(api.members.removeByOrgAndUser, args);
    },
    opts,
  );
}
