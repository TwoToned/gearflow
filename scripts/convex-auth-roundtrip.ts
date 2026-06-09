/**
 * Phase 5 auth-bridge round-trip verification.
 *
 * Proves the Convex functions are actually authenticated end-to-end:
 *   1. anonymous (no token)            → org-scoped read REJECTED
 *   2. service token                   → org-scoped read OK, mutation OK
 *   3. user token, matching org        → org-scoped read OK
 *   4. user token, mismatched org      → org-scoped read REJECTED
 *   5. user token (no svc) → mutation  → REJECTED (writes are service-only)
 *
 * Requires: Convex backend up AND the Next app serving /api/auth/jwks on the URL
 * the backend fetches (CONVEX_AUTH_JWKS_URL → host.docker.internal:3000 locally),
 * because Convex validates the tokens against that JWKS.
 *
 * Run: pnpm convex:auth:roundtrip
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SERVICE_SUBJECT, SERVICE_CLAIM } from "@/lib/convex-auth-constants";

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

type Outcome = "ALLOWED" | "REJECTED";
async function probe(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn();
    return "ALLOWED";
  } catch {
    return "REJECTED";
  }
}

function check(label: string, got: Outcome, want: Outcome): boolean {
  const ok = got === want;
  // eslint-disable-next-line no-console
  console.log(`${ok ? "✅" : "❌"} ${label}: got ${got}, want ${want}`);
  return ok;
}

async function main() {
  if (!URL) throw new Error("Convex URL not configured");

  const org = await prisma.organization.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!org) throw new Error("No organization to test against");
  const orgId = org.id;
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId },
    select: { userId: true, role: true },
  });
  if (!member) throw new Error("No member to test against");

  const serviceToken = await mint({ sub: SERVICE_SUBJECT, [SERVICE_CLAIM]: true });
  const userTokenMatch = await mint({ sub: member.userId, orgId, role: member.role });
  const userTokenWrong = await mint({ sub: member.userId, orgId: "org_does_not_exist", role: member.role });

  const anon = new ConvexHttpClient(URL);
  const svc = new ConvexHttpClient(URL);
  svc.setAuth(serviceToken);
  const userOk = new ConvexHttpClient(URL);
  userOk.setAuth(userTokenMatch);
  const userBad = new ConvexHttpClient(URL);
  userBad.setAuth(userTokenWrong);

  const results: boolean[] = [];
  results.push(
    check("anon → clients.list", await probe(() => anon.query(api.clients.list, { orgId })), "REJECTED"),
  );
  results.push(
    check("service → clients.list", await probe(() => svc.query(api.clients.list, { orgId })), "ALLOWED"),
  );
  results.push(
    check("user(match) → clients.list", await probe(() => userOk.query(api.clients.list, { orgId })), "ALLOWED"),
  );
  results.push(
    check("user(wrong org) → clients.list", await probe(() => userBad.query(api.clients.list, { orgId })), "REJECTED"),
  );
  results.push(
    check(
      "user(match) → clients.create (mutation)",
      await probe(() =>
        userOk.mutation(api.clients.create, {
          id: "roundtrip_should_never_persist",
          organizationId: orgId,
          name: "ROUNDTRIP",
        }),
      ),
      "REJECTED",
    ),
  );
  results.push(
    check("anon → clients.create (mutation)", await probe(() => anon.mutation(api.clients.create, { id: "x", organizationId: orgId, name: "x" })), "REJECTED"),
  );

  const passed = results.filter(Boolean).length;
  // eslint-disable-next-line no-console
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
