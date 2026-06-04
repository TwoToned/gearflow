/**
 * Integration tests for the Discord route trust boundary + session-less
 * permission enforcement — the /autoplan test plan's highest-risk path (#3, #4).
 *
 * Exercises the FULL pipeline against a real Postgres: signed Request →
 * withDiscordAuth (Bearer + per-org HMAC + actor resolution) → asset-service
 * (requireActorPermission) → DB. The dangerous bugs (cross-org write, bypassed
 * permission for lack of a session) only show up here, not in mock-db unit tests.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createModelFixture,
  createAssetFixture,
} from "../../../../../tests/helpers/integration";
import {
  DISCORD_ACTOR_HEADER,
  DISCORD_ORG_HEADER,
  DISCORD_SIG_HEADER,
  DISCORD_TS_HEADER,
  signDiscordRequest,
} from "@/lib/discord/hmac";
import { GET } from "./asset/[code]/route";

const SECRET = "org-a-signing-secret";
const ASSET_TAG = "TTP-042";

interface ReqOpts {
  orgId: string;
  signWithSecret?: string;
  actorDiscordId?: string;
  bearer?: string;
  tsOffsetSeconds?: number;
  tamperBody?: boolean;
}

function makeRequest(opts: ReqOpts): Request {
  const ts = Math.floor(Date.now() / 1000) + (opts.tsOffsetSeconds ?? 0);
  const signedBody = opts.tamperBody ? "tampered" : "";
  const sig = signDiscordRequest(signedBody, ts, opts.signWithSecret ?? SECRET);
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.bearer ?? "test-bot-token"}`,
    [DISCORD_ORG_HEADER]: opts.orgId,
    [DISCORD_TS_HEADER]: String(ts),
    [DISCORD_SIG_HEADER]: sig,
  };
  if (opts.actorDiscordId) headers[DISCORD_ACTOR_HEADER] = opts.actorDiscordId;
  return new Request(`http://localhost/api/discord/v1/asset/${ASSET_TAG}`, { headers });
}

async function call(opts: ReqOpts) {
  const res = await GET(makeRequest(opts), { params: Promise.resolve({ code: ASSET_TAG }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function seedLinkedActor(
  orgId: string,
  discordUserId: string,
  opts?: { role?: string; customPermissions?: object },
) {
  let userId: string | null = null;
  if (opts?.role) {
    const user = await testPrisma.user.create({
      data: { email: `${discordUserId}@test.local`, name: "Crew", emailVerified: true, updatedAt: new Date() },
    });
    userId = user.id;
    let role = opts.role;
    if (opts.customPermissions) {
      const cr = await testPrisma.customRole.create({
        data: { organizationId: orgId, name: `role-${discordUserId}`, permissions: JSON.stringify(opts.customPermissions) },
      });
      role = `custom:${cr.id}`;
    }
    await testPrisma.member.create({ data: { userId, organizationId: orgId, role, createdAt: new Date() } });
  }
  const crew = await testPrisma.crewMember.create({
    data: { organizationId: orgId, firstName: "Crew", lastName: "Member", userId },
  });
  await testPrisma.discordAccountLink.create({
    data: { organizationId: orgId, crewMemberId: crew.id, discordUserId },
  });
  return crew;
}

describe("Discord route trust boundary (integration)", () => {
  let orgId: string;

  beforeEach(async () => {
    await setupIntegrationTest();
    const org = await createOrgFixture();
    orgId = org.id;
    const model = await createModelFixture(orgId);
    await createAssetFixture(orgId, model.id, { assetTag: ASSET_TAG, status: "AVAILABLE" });
    await testPrisma.discordIntegration.create({
      data: { organizationId: orgId, isEnabled: true, signingSecret: SECRET },
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("returns the asset for a correctly-signed, linked request", async () => {
    await seedLinkedActor(orgId, "discord-1");
    const { status, body } = await call({ orgId, actorDiscordId: "discord-1" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect((body.data as { assetTag: string }).assetTag).toBe(ASSET_TAG);
  });

  it("rejects a wrong bot Bearer with SIGNATURE_INVALID", async () => {
    const { status, body } = await call({ orgId, actorDiscordId: "discord-1", bearer: "wrong" });
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("SIGNATURE_INVALID");
  });

  it("rejects a signature made with the wrong org secret (cross-tenant guard)", async () => {
    await seedLinkedActor(orgId, "discord-1");
    const { body } = await call({ orgId, actorDiscordId: "discord-1", signWithSecret: "attacker-secret" });
    expect((body.error as { code: string }).code).toBe("SIGNATURE_INVALID");
  });

  it("rejects a stale timestamp", async () => {
    const { body } = await call({ orgId, actorDiscordId: "discord-1", tsOffsetSeconds: -100000 });
    expect((body.error as { code: string }).code).toBe("SIGNATURE_INVALID");
  });

  it("rejects a tampered body", async () => {
    const { body } = await call({ orgId, actorDiscordId: "discord-1", tamperBody: true });
    expect((body.error as { code: string }).code).toBe("SIGNATURE_INVALID");
  });

  it("returns ORG_NOT_CONFIGURED when the integration is disabled", async () => {
    await testPrisma.discordIntegration.update({ where: { organizationId: orgId }, data: { isEnabled: false } });
    const { status, body } = await call({ orgId, actorDiscordId: "discord-1" });
    expect(status).toBe(409);
    expect((body.error as { code: string }).code).toBe("ORG_NOT_CONFIGURED");
  });

  it("returns NOT_LINKED when the Discord user has no link", async () => {
    const { status, body } = await call({ orgId, actorDiscordId: "stranger" });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("NOT_LINKED");
  });

  it("enforces permission server-side: a role without asset:read is FORBIDDEN", async () => {
    await seedLinkedActor(orgId, "lowpriv", { role: "custom", customPermissions: { project: ["read"] } });
    const { status, body } = await call({ orgId, actorDiscordId: "lowpriv" });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("FORBIDDEN");
  });

  it("a freelancer crew member (no User) gets the viewer baseline and can read", async () => {
    await seedLinkedActor(orgId, "freelancer"); // no role → no User → viewer
    const { status, body } = await call({ orgId, actorDiscordId: "freelancer" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
