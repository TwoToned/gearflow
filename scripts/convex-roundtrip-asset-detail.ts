/**
 * Live round-trip for the asset-detail reactive composite (bucket-B, the 2nd
 * composite after kit detail). Proves end-to-end against the running Convex
 * backend that `api.assetDetail.version` is callable with a USER token, is
 * org-scoped, and — the silent-staleness contract — CHANGES on the in-place edits
 * a naive count+timestamp vector would miss:
 *
 *   1. version() is browser-readable (user token, same org) and returns a vector.
 *   2. adding an assetMedia row changes the media signature.
 *   3. flipping assetMedia.isPrimary (setAssetPrimaryPhoto's exact write — same row
 *      count, same createdAt) changes the vector. THIS is the codex fix.
 *   4. attaching a child asset (parentAssetId = the asset) changes the children
 *      signature.
 *   5. a user token for a DIFFERENT org is rejected (org scoping).
 *
 * All synthetic rows are removed in `finally` (idempotent).
 *
 * Requires: Convex backend up + the Next /api/auth/jwks reachable at
 * CONVEX_AUTH_JWKS_URL (see the JWKS-sidecar recipe in FEATUREDOCS/54). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-asset-detail.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { createId } from "@paralleldrive/cuid2";
import { api } from "../convex/_generated/api";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

type Vector = { asset: number; media: string; children: string } | null;

async function main() {
  if (!URL) throw new Error("Convex URL not configured");

  const org = await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No organization to test against");
  const orgId = org.id;
  const member = await prisma.member.findFirst({ where: { organizationId: orgId }, select: { userId: true, role: true } });
  if (!member) throw new Error("No member to test against");
  // A real model id keeps the synthetic asset FK-consistent in the mirror.
  const model = await prisma.model.findFirst({ where: { organizationId: orgId }, select: { id: true } });
  const modelId = model?.id ?? `rt-model-${createId()}`;

  const userToken = await mint({ sub: member.userId, orgId, role: member.role });
  const userClient = new ConvexHttpClient(URL);
  userClient.setAuth(userToken);
  const svc = await getConvexClient(); // shared service client (mutations)

  const rtAssetId = `rt-asset-${createId()}`;
  const childAssetId = `rt-child-${createId()}`;
  const mediaId = createId();

  const ver = () =>
    userClient.query(api.assetDetail.version, { id: rtAssetId }) as Promise<Vector>;

  try {
    await svc.mutation(api.assets.create, {
      id: rtAssetId,
      organizationId: orgId,
      modelId,
      assetTag: `RT-${createId().slice(0, 6)}`,
      updatedAt: Date.now(),
    });

    const v0 = await ver();
    check("version() callable with user token, returns a vector", v0 !== null, JSON.stringify(v0));

    // (2) add an assetMedia row → media signature changes.
    await svc.mutation(api.assetMedia.create, {
      id: mediaId, organizationId: orgId, assetId: rtAssetId, fileId: `rt-file-${createId()}`, type: "PHOTO", isPrimary: false, createdAt: Date.now(),
    });
    const v1 = await ver();
    check("adding assetMedia changes the vector", !!v0 && !!v1 && v1.media !== v0.media, `"${v0?.media}" → "${v1?.media}"`);

    // (3) THE SILENT-STALENESS FIX: flip assetMedia.isPrimary only. Row count +
    // createdAt unchanged — a count+ts vector would MISS this; the signature must not.
    await svc.mutation(api.assetMedia.update, { id: mediaId, patch: { isPrimary: true } });
    const v2 = await ver();
    check("flipping isPrimary ONLY changes the vector (silent-staleness fix)", !!v1 && !!v2 && v2.media !== v1.media, `"${v1?.media}" → "${v2?.media}"`);

    // (4) attach a child asset (parentAssetId = the asset) → children signature changes.
    await svc.mutation(api.assets.create, {
      id: childAssetId, organizationId: orgId, modelId, assetTag: `RTC-${createId().slice(0, 6)}`, parentAssetId: rtAssetId, updatedAt: Date.now(),
    });
    const v3 = await ver();
    check("attaching a child asset changes the vector", !!v2 && !!v3 && v3.children !== v2.children, `"${v2?.children}" → "${v3?.children}"`);

    // (5) org scoping: a different-org user token is forbidden.
    const otherOrgToken = await mint({ sub: member.userId, orgId: `other-${createId()}`, role: "member" });
    const otherClient = new ConvexHttpClient(URL);
    otherClient.setAuth(otherOrgToken);
    let forbidden = false;
    try {
      await otherClient.query(api.assetDetail.version, { id: rtAssetId });
    } catch {
      forbidden = true;
    }
    check("version() rejects a user token from a different org", forbidden);
  } finally {
    await svc.mutation(api.assets.remove, { id: childAssetId }).catch(() => {});
    await svc.mutation(api.assetMedia.remove, { id: mediaId }).catch(() => {});
    await svc.mutation(api.assets.remove, { id: rtAssetId }).catch(() => {});
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
