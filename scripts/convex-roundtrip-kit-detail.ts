/**
 * Live round-trip for the kit-detail reactive composite (session 2026-06-10n — the
 * bucket-B keystone). Proves end-to-end against the running Convex backend that the
 * `api.kitDetail.version` "version vector" is callable with a USER token, is
 * org-scoped, and — the silent-staleness contract codex flagged — CHANGES on the
 * in-place edits a naive count+timestamp vector would miss:
 *
 *   1. version() is browser-readable (user token, same org) and returns a vector.
 *   2. adding a serialized member changes the vector.
 *   3. flipping kitMedia.isPrimary (setKitPrimaryPhoto's exact write — same row
 *      count, same createdAt) changes the vector. THIS is the codex fix.
 *   4. a user token for a DIFFERENT org is rejected (org scoping).
 *
 * All synthetic rows are removed in `finally` (idempotent).
 *
 * Requires: Convex backend up + the Next /api/auth/jwks reachable at
 * CONVEX_AUTH_JWKS_URL (see the JWKS-sidecar recipe in FEATUREDOCS/54). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-kit-detail.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { createId } from "@paralleldrive/cuid2";
import { api } from "../convex/_generated/api";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SERVICE_SUBJECT, SERVICE_CLAIM } from "@/lib/convex-auth-constants";
import { getConvexClient } from "@/lib/convex-client";

const URL = process.env.CONVEX_SELF_HOSTED_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

function nowExp(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds;
}
async function mint(payload: Record<string, unknown>): Promise<string> {
  const res = (await auth.api.signJWT({
    body: { payload: { exp: nowExp(300), ...payload } },
  })) as { token?: string } | null;
  if (!res?.token) throw new Error("signJWT returned no token");
  return res.token;
}

const results: boolean[] = [];
function check(label: string, ok: boolean, detail = "") {
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Vector = { kit: number; serialized: string; bulk: string; media: string } | null;

async function main() {
  if (!URL) throw new Error("Convex URL not configured");

  const org = await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No organization to test against");
  const orgId = org.id;
  const member = await prisma.member.findFirst({ where: { organizationId: orgId }, select: { userId: true, role: true } });
  if (!member) throw new Error("No member to test against");

  const userToken = await mint({ sub: member.userId, orgId, role: member.role });
  const userClient = new ConvexHttpClient(URL);
  userClient.setAuth(userToken);
  const svc = await getConvexClient(); // shared service client (mutations)

  const rtKitId = `rt-kit-${createId()}`;
  const serId = createId();
  const mediaId = createId();

  const ver = () =>
    userClient.query(api.kitDetail.version, { id: rtKitId }) as Promise<Vector>;

  try {
    await svc.mutation(api.kits.create, {
      id: rtKitId,
      organizationId: orgId,
      assetTag: `RT-${createId().slice(0, 6)}`,
      name: "Roundtrip Kit",
      updatedAt: Date.now(),
    });

    const v0 = await ver();
    check("version() callable with user token, returns a vector", v0 !== null, JSON.stringify(v0));

    // (2) add a serialized member → serialized signature changes.
    await svc.mutation(api.kitSerializedItems.create, {
      id: serId, organizationId: orgId, kitId: rtKitId, assetId: `rt-asset-${createId()}`, addedById: member.userId, addedAt: Date.now(),
    });
    const v1 = await ver();
    check("adding a serialized member changes the vector", !!v0 && !!v1 && v1.serialized !== v0.serialized, `"${v0?.serialized}" → "${v1?.serialized}"`);

    // (3) THE CODEX FIX: flip kitMedia.isPrimary only. Row count + createdAt
    // unchanged — a count+ts vector would MISS this; the content signature must not.
    await svc.mutation(api.kitMedia.create, {
      id: mediaId, organizationId: orgId, kitId: rtKitId, fileId: `rt-file-${createId()}`, type: "PHOTO", isPrimary: false, createdAt: Date.now(),
    });
    const v2 = await ver();
    check("adding media changes the vector", !!v1 && !!v2 && v2.media !== v1.media, `"${v1?.media}" → "${v2?.media}"`);

    await svc.mutation(api.kitMedia.update, { id: mediaId, patch: { isPrimary: true } });
    const v3 = await ver();
    check("flipping isPrimary ONLY changes the vector (silent-staleness fix)", !!v2 && !!v3 && v3.media !== v2.media, `"${v2?.media}" → "${v3?.media}"`);

    // (4) org scoping: a different-org user token is forbidden.
    const otherOrgToken = await mint({ sub: member.userId, orgId: `other-${createId()}`, role: "member" });
    const otherClient = new ConvexHttpClient(URL);
    otherClient.setAuth(otherOrgToken);
    let forbidden = false;
    try {
      await otherClient.query(api.kitDetail.version, { id: rtKitId });
    } catch {
      forbidden = true;
    }
    check("version() rejects a user token from a different org", forbidden);
  } finally {
    await svc.mutation(api.kitMedia.remove, { id: mediaId }).catch(() => {});
    await svc.mutation(api.kitSerializedItems.remove, { id: serId }).catch(() => {});
    await svc.mutation(api.kits.remove, { id: rtKitId }).catch(() => {});
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
