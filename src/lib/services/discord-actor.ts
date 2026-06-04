/**
 * Session-less actor resolution + permission enforcement for the Discord bot.
 *
 * RUNTIME-KILLER #1 (from the /autoplan eng review): `requirePermission()` in
 * org-context.ts calls `getOrgContext()` → `requireOrganization()`, which reads a
 * Better Auth session. A bot route has NO session, so those helpers throw at
 * runtime. The fix is this module: a bot route resolves a `ServiceActor` from the
 * signed `x-gearflow-actor-discord-id` header and enforces permission EXPLICITLY
 * against the same `hasPermission()` matrix the session-bound path uses — so the
 * permission check runs identically whether the caller is a logged-in user or the
 * bot, and is never bypassed for lack of a session.
 *
 * Plain `src/lib/*` module (not "use server") — see CLAUDE.md on re-export crashes.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hasPermission,
  type PermissionMap,
  type Resource,
} from "@/lib/permissions";
import { DiscordApiError } from "@/lib/discord/api-errors";

type Db = Prisma.TransactionClient;

/**
 * The person behind a bot interaction, resolved server-side from a signed
 * request. `role` is the authoritative GearFlow role used for permission checks
 * — never client-supplied. A linked CrewMember with a platform User uses that
 * User's org `Member.role`; a freelancer (no User) gets the read-only `viewer`
 * baseline so they can run lookups but not mutate.
 */
export interface ServiceActor {
  organizationId: string;
  crewMemberId: string;
  /** Platform user id, or null for a freelancer CrewMember. */
  userId: string | null;
  userName: string;
  /** Org role string (built-in or "custom:<id>"). Defaults to "viewer". */
  role: string;
  discordUserId: string;
}

/** Read-only baseline for a linked crew member without a platform User. */
const FREELANCER_BASELINE_ROLE = "viewer";

/**
 * Resolve a Discord user → ServiceActor within one org. Returns null when the
 * Discord user has not completed `/link` in this org (the route maps that to
 * NOT_LINKED). Role is read LIVE here (never cached) so a demotion takes effect
 * on the next interaction.
 */
export async function resolveDiscordActor(
  organizationId: string,
  discordUserId: string,
  db: Db = prisma,
): Promise<ServiceActor | null> {
  const link = await db.discordAccountLink.findUnique({
    where: {
      organizationId_discordUserId: { organizationId, discordUserId },
    },
    include: { crewMember: true },
  });
  if (!link) return null;

  const cm = link.crewMember;
  let role = FREELANCER_BASELINE_ROLE;
  if (cm.userId) {
    const member = await db.member.findFirst({
      where: { organizationId, userId: cm.userId },
      select: { role: true },
    });
    if (member) role = member.role;
  }

  return {
    organizationId,
    crewMemberId: cm.id,
    userId: cm.userId,
    userName: `${cm.firstName} ${cm.lastName}`.trim() || "Crew member",
    role,
    discordUserId,
  };
}

/** Resolve a custom role's permission map (built-in roles return null → static map). */
async function resolveCustomPermissions(
  role: string,
  db: Db,
): Promise<PermissionMap | null> {
  if (!role.startsWith("custom:")) return null;
  const customRoleId = role.slice("custom:".length);
  const customRole = await db.customRole.findUnique({
    where: { id: customRoleId },
    select: { permissions: true },
  });
  if (!customRole) return null;
  try {
    return JSON.parse(customRole.permissions) as PermissionMap;
  } catch {
    return null;
  }
}

/**
 * Enforce a permission for the actor's role. Throws a FORBIDDEN DiscordApiError
 * (carrying requiredRole/actualRole so the bot renders actionable copy) when the
 * role lacks the action. Mirrors `requirePermission()` minus the session lookup.
 */
export async function requireActorPermission(
  actor: ServiceActor,
  resource: Resource,
  action: string,
  db: Db = prisma,
): Promise<void> {
  let customPermissions: PermissionMap | null = null;
  if (actor.role.startsWith("custom:")) {
    customPermissions = await resolveCustomPermissions(actor.role, db);
    if (!customPermissions) {
      throw new DiscordApiError("FORBIDDEN", "Your role no longer exists.", {
        details: { actualRole: actor.role },
      });
    }
  }

  if (!hasPermission(actor.role, resource, action, customPermissions)) {
    throw new DiscordApiError(
      "FORBIDDEN",
      `Missing permission ${resource}:${action}.`,
      { details: { requiredPermission: `${resource}:${action}`, actualRole: actor.role } },
    );
  }
}
