/**
 * Live round-trip for the warehouse-list reactive composite (bucket-B). Proves
 * end-to-end against the running Convex backend that `api.warehouseDetail.listVersion`
 * is callable with a USER token, is org-scoped, and that its "version vector" moves
 * exactly when the warehouse landing list's visible set changes:
 *
 *   1. listVersion() is browser-readable (user token, same org) and returns a vector.
 *   2. creating a project in a warehouse-pipeline status (CONFIRMED) changes it.
 *   3. an in-place status flip within the pipeline (CONFIRMED → PREPPING) changes it.
 *   4. ★ renaming the referenced CLIENT (project row untouched) changes it — the
 *      codex-review fix (the card renders client.name, a cross-domain join).
 *   5. leaving the pipeline (PREPPING → COMPLETED) changes it (the card disappears).
 *   6. ★ a change between two NON-pipeline statuses (COMPLETED → INVOICED) does NOT
 *      change it — the tight-scope proof (no over-eager refresh for off-list projects).
 *   7. a user token for a DIFFERENT org is rejected (org scoping).
 *
 * The synthetic project is removed in `finally` (idempotent).
 *
 * Requires: Convex backend up + the Next /api/auth/jwks reachable at
 * CONVEX_AUTH_JWKS_URL (see the JWKS-sidecar recipe in FEATUREDOCS/54). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-warehouse-list.ts
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

type Vector = { projects: string } | null;

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

  const ver = () =>
    userClient.query(api.warehouseDetail.listVersion, { orgId }) as Promise<Vector>;

  try {
    await svc.mutation(api.clients.create, {
      id: rtClientId,
      organizationId: orgId,
      name: "RT Client A",
    });

    const v0 = await ver();
    check("listVersion() callable with user token, returns a vector", v0 !== null, JSON.stringify(v0)?.slice(0, 60));

    // (2) create a pipeline-status project (with a client) → it appears in the signature.
    await svc.mutation(api.projects.create, {
      id: rtProjectId,
      organizationId: orgId,
      projectNumber: `RT-${createId().slice(0, 6)}`,
      name: "Roundtrip Warehouse Project",
      status: "CONFIRMED",
      clientId: rtClientId,
      updatedAt: Date.now(),
    });
    const v1 = await ver();
    check("creating a CONFIRMED project changes the vector", !!v0 && !!v1 && v1.projects !== v0.projects);

    // (3) in-place status flip within the pipeline.
    await svc.mutation(api.projects.update, { id: rtProjectId, patch: { status: "PREPPING" } });
    const v2 = await ver();
    check("in-place CONFIRMED → PREPPING changes the vector", !!v1 && !!v2 && v2.projects !== v1.projects);

    // (4) ★ codex fix: rename the CLIENT (the project row is untouched) → the card
    // renders client.name, so the vector must move.
    await svc.mutation(api.clients.update, { id: rtClientId, patch: { name: "RT Client B" } });
    const v2b = await ver();
    check("renaming the referenced client changes the vector (codex fix)", !!v2 && !!v2b && v2b.projects !== v2.projects);

    // (5) leaving the pipeline (card disappears).
    await svc.mutation(api.projects.update, { id: rtProjectId, patch: { status: "COMPLETED" } });
    const v3 = await ver();
    check("PREPPING → COMPLETED (leaves the list) changes the vector", !!v2b && !!v3 && v3.projects !== v2b.projects);

    // (6) ★ tight-scope: two non-pipeline statuses → NO change.
    await svc.mutation(api.projects.update, { id: rtProjectId, patch: { status: "INVOICED" } });
    const v4 = await ver();
    check("COMPLETED → INVOICED (both off-list) does NOT change the vector", !!v3 && !!v4 && v4.projects === v3.projects);

    // (7) org scoping.
    const otherOrgToken = await mint({ sub: member.userId, orgId: `other-${createId()}`, role: "member" });
    const otherClient = new ConvexHttpClient(URL);
    otherClient.setAuth(otherOrgToken);
    let forbidden = false;
    try {
      await otherClient.query(api.warehouseDetail.listVersion, { orgId });
    } catch {
      forbidden = true;
    }
    check("listVersion() rejects a user token from a different org", forbidden);
  } finally {
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
