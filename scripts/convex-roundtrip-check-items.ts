/**
 * Live round-trip for the check-item-assignment decommission + icalToken redaction
 * (session 2026-06-10e). Proves end-to-end against the running Convex backend:
 *
 *   1. model_check_item / kit_check_item counts come off the Convex mirror:
 *      insert a synthetic assignment via the service token, then assert the
 *      server-side count-map helpers (getModelCheckItemCountMap /
 *      getKitCheckItemCountMap — the warehouse source) see it.
 *   2. crewMembers.icalToken is redacted for BROWSER (user-token) reads but
 *      visible to the trusted SERVICE token — the tracked sub-8 security residual.
 *
 * All synthetic rows are removed at the end (idempotent cleanup in `finally`).
 *
 * Requires: Convex backend up + the Next /api/auth/jwks reachable at
 * CONVEX_AUTH_JWKS_URL (see the JWKS-sidecar recipe in FEATUREDOCS/54). Run:
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-roundtrip-check-items.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { createId } from "@paralleldrive/cuid2";
import { api } from "../convex/_generated/api";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SERVICE_SUBJECT, SERVICE_CLAIM } from "@/lib/convex-auth-constants";
import { getConvexClient } from "@/lib/convex-client";
import {
  getModelCheckItemCountMap,
  getKitCheckItemCountMap,
} from "@/lib/line-item-tree-read";

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

async function main() {
  if (!URL) throw new Error("Convex URL not configured");

  const org = await prisma.organization.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No organization to test against");
  const orgId = org.id;
  const member = await prisma.member.findFirst({ where: { organizationId: orgId }, select: { userId: true, role: true } });
  if (!member) throw new Error("No member to test against");

  const userToken = await mint({ sub: member.userId, orgId, role: member.role });
  const serviceToken = await mint({ sub: SERVICE_SUBJECT, [SERVICE_CLAIM]: true });
  const userClient = new ConvexHttpClient(URL);
  userClient.setAuth(userToken);
  const svcClient = new ConvexHttpClient(URL);
  svcClient.setAuth(serviceToken);
  const svc = await getConvexClient(); // shared service client (the warehouse path)

  // Synthetic ids so we never collide with real data.
  const rtModelId = `rt-model-${createId()}`;
  const rtKitId = `rt-kit-${createId()}`;
  const mciId = createId();
  const kciId = createId();
  const crewId = createId();
  const SECRET = `rt-ical-${createId()}`;

  try {
    // ── (1) counts off the Convex mirror ──────────────────────────────────────
    await svc.mutation(api.modelCheckItems.create, {
      id: mciId, organizationId: orgId, modelId: rtModelId, checkItemId: createId(), sortOrder: 0, createdAt: Date.now(),
    });
    await svc.mutation(api.kitCheckItems.create, {
      id: kciId, organizationId: orgId, kitId: rtKitId, checkItemId: createId(), sortOrder: 0, createdAt: Date.now(),
    });

    const modelCounts = await getModelCheckItemCountMap(orgId);
    check("getModelCheckItemCountMap sees the inserted model_check_item", modelCounts.get(rtModelId) === 1, `count=${modelCounts.get(rtModelId)}`);
    const kitCounts = await getKitCheckItemCountMap(orgId);
    check("getKitCheckItemCountMap sees the inserted kit_check_item", kitCounts.get(rtKitId) === 1, `count=${kitCounts.get(rtKitId)}`);

    // ── (2) icalToken redaction ────────────────────────────────────────────────
    await svc.mutation(api.crewMembers.create, {
      id: crewId, organizationId: orgId, firstName: "Roundtrip", lastName: "Crew", icalEnabled: true, icalToken: SECRET,
    });

    const svcList = await svcClient.query(api.crewMembers.list, { orgId });
    const svcRow = svcList.find((c) => c.id === crewId) as { icalToken?: string } | undefined;
    check("service list → icalToken VISIBLE", svcRow?.icalToken === SECRET);

    const userList = await userClient.query(api.crewMembers.list, { orgId });
    const userRow = userList.find((c) => c.id === crewId) as { icalToken?: string } | undefined;
    check("user list → icalToken REDACTED", userRow !== undefined && userRow.icalToken === undefined, userRow === undefined ? "row missing!" : "");

    const svcDoc = (await svcClient.query(api.crewMembers.getById, { id: crewId })) as { icalToken?: string } | null;
    check("service getById → icalToken VISIBLE", svcDoc?.icalToken === SECRET);
    const userDoc = (await userClient.query(api.crewMembers.getById, { id: crewId })) as { icalToken?: string } | null;
    check("user getById → icalToken REDACTED", userDoc != null && userDoc.icalToken === undefined);
    // Redaction must not nuke the rest of the row.
    check("user getById → non-secret fields intact", (userDoc as { firstName?: string } | null)?.firstName === "Roundtrip");
  } finally {
    // Cleanup — remove every synthetic row.
    await svc.mutation(api.modelCheckItems.remove, { id: mciId }).catch(() => {});
    await svc.mutation(api.kitCheckItems.remove, { id: kciId }).catch(() => {});
    await svc.mutation(api.crewMembers.remove, { id: crewId }).catch(() => {});
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
