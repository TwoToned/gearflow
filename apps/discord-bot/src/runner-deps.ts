/**
 * Production RunnerDeps + bootstrap helpers. The runner contract was always:
 *   - resolveActor(discordUserId, guildId)  → ResolvedActor
 *   - apiFor(actor)                         → GearFlowApiClient
 *
 * Single-org per process for v1: GEARFLOW_ORG_ID + GEARFLOW_DISCORD_SIGNING_SECRET
 * come from env (operator copies the signing secret from /settings/discord). A
 * future multi-tenant bot would resolve org-from-guildId via a bootstrap call,
 * but this org-per-process shape matches Two Toned's deployment.
 *
 * resolveActor calls GET /v1/me with the invoker's signed Discord id header. The
 * app returns the live link state (never cached), so a demoted role takes effect
 * on the next slash command.
 */
import { GearFlowApiClientImpl } from "./api-client.js";
import type { BotEnv } from "./env.js";
import type { RunnerDeps } from "./runner.js";
import type { GearFlowApiClient, GearFlowRole, ResolvedActor } from "./types.js";

interface MeResponse {
  discordUserId: string;
  link: {
    organizationId: string;
    crewMemberId: string;
    role: GearFlowRole | string | null;
    userName: string;
  } | null;
}

/** Build a signing client targeting an org with an optional invoker actor. */
export function buildApiClient(env: BotEnv, actorDiscordUserId?: string): GearFlowApiClient {
  return new GearFlowApiClientImpl({
    baseUrl: env.GEARFLOW_API_URL,
    signingSecret: env.GEARFLOW_DISCORD_SIGNING_SECRET,
    botToken: env.GEARFLOW_BOT_BEARER,
    organizationId: env.GEARFLOW_ORG_ID,
    actorDiscordUserId,
  });
}

const ROLE_WHITELIST: readonly GearFlowRole[] = ["owner", "admin", "manager", "staff", "warehouse", "viewer"];

function narrowRole(role: string | null | undefined): GearFlowRole | null {
  if (!role) return null;
  // Custom roles ("custom:<id>") pass through as unknown; we surface them as
  // null here so the bot's declarative gate (which only matches built-ins) falls
  // back to NOT_LINKED-style messaging. The SERVER-side gate is the source of
  // truth — `requireActorPermission` handles custom roles correctly there.
  return (ROLE_WHITELIST as readonly string[]).includes(role) ? (role as GearFlowRole) : null;
}

/**
 * Build the production deps the runner consumes per interaction. `nowMember`
 * lookups against the GearFlow API are not memoized — the runner already
 * enforces "checked LIVE per interaction".
 */
export function buildRunnerDeps(env: BotEnv): RunnerDeps {
  return {
    async resolveActor(discordUserId: string): Promise<ResolvedActor> {
      const client = buildApiClient(env, discordUserId);
      const me = await client.get<MeResponse>("/me");
      return {
        discordUserId: me.discordUserId,
        link: me.link
          ? {
              organizationId: me.link.organizationId,
              crewMemberId: me.link.crewMemberId,
              role: narrowRole(me.link.role),
            }
          : null,
      };
    },
    apiFor(actor: ResolvedActor): GearFlowApiClient {
      return buildApiClient(env, actor.discordUserId);
    },
  };
}
