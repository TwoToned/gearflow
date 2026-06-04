/**
 * Hardened Discord account enrollment (`/link`). Security requirements from the
 * /autoplan eng review (all MANDATORY):
 *
 *  - No enumeration oracle — `startDiscordLink` returns a CONSTANT "pending"
 *    result whether or not the email matched, so the bot can render one fixed
 *    "if that email is on file, a link was sent" message either way.
 *  - No email bomb — durable, DB-backed rate limits (per Discord user 3/hr, per
 *    target crew member 3/day) counted from issued tokens (the only attempts that
 *    actually send mail). In-memory limiters reset on deploy, so they're not used
 *    for this security-critical path.
 *  - Org-scoped resolution only — `CrewMember.findMany({ organizationId, email })`
 *    within the guild's org; 0 or >1 matches send nothing (nullable + per-org email).
 *  - Anti-hijack — the invoker's Discord id is bound into the token AT ISSUE TIME,
 *    so a leaked link cannot attach a *different* Discord account to the victim.
 *  - Token = opaque randomBytes(32), HASH-AT-REST only, single-use, consumed
 *    atomically (`updateMany` guarded on `consumedAt null AND expiresAt > now`).
 */
import crypto from "crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";
import { sendEmail as realSendEmail } from "@/lib/email";
import { emitIfDiscordEnabled } from "./outbox-service";

type Db = Prisma.TransactionClient;

const RATE_PER_USER = 3;
const RATE_PER_USER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_PER_EMAIL = 3;
const RATE_PER_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day
const DEFAULT_TTL_MINUTES = 15;

/** sha256 hex of the raw token — only this is ever stored. */
export function hashLinkToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface StartLinkInput {
  organizationId: string;
  /** The invoking Discord user (signed header) — bound into the token. */
  discordUserId: string;
  email: string;
}

export type StartLinkResult =
  | { status: "already_linked"; linkedToName: string }
  | { status: "pending" }; // CONSTANT — never reveals whether the email matched

interface StartLinkDeps {
  db?: Db;
  sendEmail?: (args: { to: string; subject: string; html: string }) => Promise<unknown>;
  now?: Date;
  appUrl?: string;
  generateToken?: () => string;
}

/**
 * Begin enrollment. Always returns "pending" unless the INVOKER is already linked
 * (safe to reveal — it's their own account). Side effects (token + email) happen
 * only on an unambiguous, non-rate-limited match, but are invisible in the result.
 */
export async function startDiscordLink(
  input: StartLinkInput,
  deps: StartLinkDeps = {},
): Promise<StartLinkResult> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const sendEmail = deps.sendEmail ?? realSendEmail;
  const appUrl = deps.appUrl ?? env.NEXT_PUBLIC_APP_URL;

  // 1. Is the INVOKER already linked in this org? (about themselves — not an oracle)
  const existing = await db.discordAccountLink.findUnique({
    where: {
      organizationId_discordUserId: {
        organizationId: input.organizationId,
        discordUserId: input.discordUserId,
      },
    },
    include: { crewMember: { select: { firstName: true, lastName: true } } },
  });
  if (existing) {
    return {
      status: "already_linked",
      linkedToName: `${existing.crewMember.firstName} ${existing.crewMember.lastName}`.trim(),
    };
  }

  const email = input.email.trim().toLowerCase();
  // From here on, EVERY path returns the constant "pending".
  if (!email) return { status: "pending" };

  // 2. Org-scoped resolution. 0 or >1 ⇒ send nothing (constant response).
  const matches = await db.crewMember.findMany({
    where: {
      organizationId: input.organizationId,
      email: { equals: email, mode: "insensitive" },
      status: "ACTIVE",
    },
    select: { id: true },
    take: 2,
  });
  if (matches.length !== 1) return { status: "pending" };
  const crewMemberId = matches[0].id;

  // 3. Durable rate limits (counted from issued tokens = the mails actually sent).
  const sinceUser = new Date(now.getTime() - RATE_PER_USER_WINDOW_MS);
  const sinceEmail = new Date(now.getTime() - RATE_PER_EMAIL_WINDOW_MS);
  const [perUser, perEmail] = await Promise.all([
    db.discordLinkToken.count({
      where: { organizationId: input.organizationId, discordUserId: input.discordUserId, createdAt: { gte: sinceUser } },
    }),
    db.discordLinkToken.count({
      where: { organizationId: input.organizationId, crewMemberId, createdAt: { gte: sinceEmail } },
    }),
  ]);
  if (perUser >= RATE_PER_USER || perEmail >= RATE_PER_EMAIL) return { status: "pending" };

  // 4. Issue an opaque, hash-at-rest, Discord-id-bound, single-use token.
  const integration = await db.discordIntegration.findUnique({
    where: { organizationId: input.organizationId },
    select: { linkTokenTtlMinutes: true, guildId: true },
  });
  const ttlMinutes = integration?.linkTokenTtlMinutes ?? DEFAULT_TTL_MINUTES;
  const rawToken = deps.generateToken?.() ?? crypto.randomBytes(32).toString("base64url");
  await db.discordLinkToken.create({
    data: {
      organizationId: input.organizationId,
      crewMemberId,
      tokenHash: hashLinkToken(rawToken),
      discordUserId: input.discordUserId,
      guildId: integration?.guildId ?? null,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
    },
  });

  const verifyUrl = `${appUrl}/api/discord/verify?token=${encodeURIComponent(rawToken)}`;
  await sendEmail({
    to: email,
    subject: "Link your Discord account to GearFlow",
    html: linkEmailHtml(verifyUrl, ttlMinutes),
  });

  return { status: "pending" };
}

export type ConsumeLinkResult =
  | { status: "linked"; crewName: string }
  | { status: "already_linked" }
  | { status: "invalid" };

/**
 * Consume a verification token and create the account link. Atomic + single-use:
 * the `updateMany` claim guarded on `consumedAt null AND expiresAt > now` makes a
 * second click (or a concurrent race) a no-op. Re-link to an already-linked crew
 * member or Discord id is rejected (the token is still burned). Emits
 * `discord.link.confirmed` so channel access is granted retroactively.
 */
export async function consumeDiscordLink(
  rawToken: string,
  client: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<ConsumeLinkResult> {
  const tokenHash = hashLinkToken(rawToken);
  return client.$transaction(async (tx) => {
    const claim = await tx.discordLinkToken.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claim.count !== 1) return { status: "invalid" };

    const token = await tx.discordLinkToken.findUnique({
      where: { tokenHash },
      include: { crewMember: { select: { firstName: true, lastName: true } } },
    });
    if (!token) return { status: "invalid" };

    // Reject re-link (crew already linked, or this Discord id already used here).
    const conflict = await tx.discordAccountLink.findFirst({
      where: {
        OR: [
          { crewMemberId: token.crewMemberId },
          { organizationId: token.organizationId, discordUserId: token.discordUserId },
        ],
      },
    });
    if (conflict) return { status: "already_linked" };

    await tx.discordAccountLink.create({
      data: {
        organizationId: token.organizationId,
        crewMemberId: token.crewMemberId,
        discordUserId: token.discordUserId,
      },
    });

    await emitIfDiscordEnabled(tx, {
      organizationId: token.organizationId,
      eventType: "discord.link.confirmed",
      payload: { crewMemberId: token.crewMemberId, discordUserId: token.discordUserId },
      dedupeKey: `discord.link.confirmed:${token.id}`,
    });

    return {
      status: "linked",
      crewName: `${token.crewMember.firstName} ${token.crewMember.lastName}`.trim(),
    };
  });
}

function linkEmailHtml(verifyUrl: string, ttlMinutes: number): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="font-size:20px;color:#111827;margin:0 0 16px;">Link your Discord account</h1>
    <p style="color:#374151;line-height:1.6;">Someone (hopefully you) asked to connect a Discord account to your GearFlow crew profile. Click below to confirm. This link expires in ${ttlMinutes} minutes and can be used once.</p>
    <p style="margin:24px 0;"><a href="${verifyUrl}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;">Confirm Discord link</a></p>
    <p style="color:#9ca3af;font-size:13px;line-height:1.6;">If you didn't request this, ignore this email — no account will be linked.</p>
  </div>
</body>
</html>`;
}
