/**
 * Live round-trip for the per-project warehouse DETAIL reactive composite
 * (bucket-B). Proves end-to-end against the running Convex backend that
 * `api.warehouseDetail.version` is callable with a USER token, is org-scoped, and
 * that its "version vector" moves exactly when the detail page's mutable surface
 * changes:
 *
 *   1. version() is browser-readable (user token, same org) and returns a vector.
 *   2. adding an EQUIPMENT line item to the project changes it (row added).
 *   3. ★ an IN-PLACE line-item check-out (status → CHECKED_OUT + checkedOutQuantity
 *      flip at the SAME row count) changes it — the SILENT-STALENESS PROOF: a
 *      count+max-ts vector would miss this; a content signature must catch it.
 *   4. ★ an IN-PLACE return (returnedQuantity flip, same row count) changes it.
 *   5. renaming the referenced CLIENT (project row untouched) changes it — the
 *      header renders project.client.name, a cross-domain join (same class as the
 *      listVersion codex fix).
 *   6. a project status flip (CONFIRMED → PREPPING) changes it (header pill).
 *   7. a user token for a DIFFERENT org is rejected (org scoping).
 *
 * The synthetic project/line-item/client are removed in `finally` (idempotent).
 *
 * Requires: Convex backend up + the Next /api/auth/jwks reachable at
 * CONVEX_AUTH_JWKS_URL (see the JWKS-sidecar recipe in FEATUREDOCS/54). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-warehouse-detail.ts
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

type Vector = { project: number; status: string; client: string; lineItems: string } | null;

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
  const svc = await getConvexClient();

  const rtProjectId = `rt-proj-${createId()}`;
  const rtClientId = `rt-client-${createId()}`;
  const rtLineItemId = `rt-li-${createId()}`;

  const ver = () =>
    userClient.query(api.warehouseDetail.version, { projectId: rtProjectId }) as Promise<Vector>;

  try {
    await svc.mutation(api.clients.create, {
      id: rtClientId,
      organizationId: orgId,
      name: "RT Client A",
    });
    await svc.mutation(api.projects.create, {
      id: rtProjectId,
      organizationId: orgId,
      projectNumber: `RT-${createId().slice(0, 6)}`,
      name: "Roundtrip Warehouse Detail Project",
      status: "CONFIRMED",
      clientId: rtClientId,
      updatedAt: Date.now(),
    });

    const v0 = await ver();
    check("version() callable with user token, returns a vector", v0 !== null, JSON.stringify(v0)?.slice(0, 60));

    // (2) add an EQUIPMENT line item → row appears in the signature.
    await svc.mutation(api.projectLineItems.create, {
      id: rtLineItemId,
      organizationId: orgId,
      projectId: rtProjectId,
      type: "EQUIPMENT",
      status: "CONFIRMED",
      quantity: 1,
      checkedOutQuantity: 0,
      returnedQuantity: 0,
      updatedAt: Date.now(),
    });
    const v1 = await ver();
    check("adding an EQUIPMENT line item changes the vector", !!v0 && !!v1 && v1.lineItems !== v0.lineItems);

    // (3) ★ in-place check-out: status → CHECKED_OUT + checkedOutQuantity 0→1 at the
    // SAME row count. The silent-staleness proof — the content signature must move.
    await svc.mutation(api.projectLineItems.update, {
      id: rtLineItemId,
      patch: { status: "CHECKED_OUT", checkedOutQuantity: 1 },
    });
    const v2 = await ver();
    check("★ in-place line-item check-out (same row count) changes the vector", !!v1 && !!v2 && v2.lineItems !== v1.lineItems);

    // (4) ★ in-place return: returnedQuantity 0→1, same row count.
    await svc.mutation(api.projectLineItems.update, {
      id: rtLineItemId,
      patch: { status: "RETURNED", returnedQuantity: 1 },
    });
    const v3 = await ver();
    check("★ in-place line-item return (same row count) changes the vector", !!v2 && !!v3 && v3.lineItems !== v2.lineItems);

    // (5) rename the CLIENT (project row untouched) → the header renders client.name.
    await svc.mutation(api.clients.update, { id: rtClientId, patch: { name: "RT Client B" } });
    const v4 = await ver();
    check("renaming the referenced client changes the vector (header join)", !!v3 && !!v4 && v4.client !== v3.client);

    // (6) project status flip → header pill + project.updatedAt.
    await svc.mutation(api.projects.update, { id: rtProjectId, patch: { status: "PREPPING", updatedAt: Date.now() } });
    const v5 = await ver();
    check("project status CONFIRMED → PREPPING changes the vector", !!v4 && !!v5 && v5.status !== v4.status);

    // (7) org scoping.
    const otherOrgToken = await mint({ sub: member.userId, orgId: `other-${createId()}`, role: "member" });
    const otherClient = new ConvexHttpClient(URL);
    otherClient.setAuth(otherOrgToken);
    let forbidden = false;
    try {
      await otherClient.query(api.warehouseDetail.version, { projectId: rtProjectId });
    } catch {
      forbidden = true;
    }
    check("version() rejects a user token from a different org", forbidden);
  } finally {
    await svc.mutation(api.projectLineItems.remove, { id: rtLineItemId }).catch(() => {});
    await svc.mutation(api.projects.remove, { id: rtProjectId }).catch(() => {});
    await svc.mutation(api.clients.remove, { id: rtClientId }).catch(() => {});
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
