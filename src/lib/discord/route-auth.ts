/**
 * Route wrappers for `src/app/api/discord/v1/*`. Two trust boundaries:
 *
 *  - `withBotAuth`     — global `DISCORD_BOT_TOKEN` Bearer only. For the outbox
 *                        pull + heartbeat (no per-org body to sign, no actor).
 *  - `withDiscordAuth` — global Bearer + per-org HMAC over `timestamp.rawBody`
 *                        (the documented per-org boundary) + server-side actor
 *                        resolution from the signed `x-gearflow-actor-discord-id`.
 *
 * Both render thrown `DiscordApiError`s into the machine-readable envelope so the
 * bot can switch on `error.code` exhaustively. A handler may also return raw bytes
 * (e.g. a PDF) by returning a `NextResponse` directly — it passes through unwrapped.
 *
 * Plain `src/lib/*` module (not "use server").
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { prisma } from "@/lib/prisma";
import {
  DiscordApiError,
  discordErrorBody,
  discordSuccessBody,
  newRequestId,
} from "./api-errors";
import {
  DISCORD_ACTOR_HEADER,
  DISCORD_ORG_HEADER,
  DISCORD_SIG_HEADER,
  DISCORD_TS_HEADER,
  verifyDiscordRequest,
} from "./hmac";
import { resolveDiscordActor, type ServiceActor } from "@/lib/services/discord-actor";

/** Context handed to a `withBotAuth` handler. */
export interface BotRouteContext<P = undefined> {
  request: Request;
  requestId: string;
  /** From the `x-gearflow-org` header, if the caller scoped the request. */
  organizationId: string | null;
  params: P;
}

/** Context handed to a `withDiscordAuth` handler. */
export interface DiscordRouteContext<P = undefined> {
  request: Request;
  requestId: string;
  organizationId: string;
  /** Raw request body (signature-verified). Empty string for GET. */
  rawBody: string;
  /** Parsed JSON body, or undefined when there is no body. */
  json: unknown;
  /** Resolved actor, or null when the Discord user has not linked in this org. */
  actor: ServiceActor | null;
  /** Raw signed invoker Discord id — present even pre-link (e.g. for /link). */
  actorDiscordUserId: string | null;
  /** The Discord interaction id, used for command→API idempotency. */
  idempotencyKey: string | null;
  params: P;
}

type NextRouteArgs<P> = [request: Request, ctx: { params: Promise<P> }];

/** Constant-time compare that never throws on length mismatch (Bearer token). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Verify the global service Bearer. Throws INTERNAL if unconfigured, SIGNATURE_INVALID if wrong. */
function requireBotToken(request: Request): void {
  const expected = env.DISCORD_BOT_TOKEN;
  if (!expected) {
    throw new DiscordApiError("INTERNAL", "DISCORD_BOT_TOKEN is not configured.");
  }
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const provided = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  if (!provided || !safeEqual(provided, expected)) {
    throw new DiscordApiError("SIGNATURE_INVALID", "Invalid or missing bot token.");
  }
}

async function resolveParams<P>(args: NextRouteArgs<P>): Promise<P> {
  const ctx = args[1];
  return (ctx?.params ? await ctx.params : (undefined as P)) as P;
}

/** Build the final NextResponse from a handler result (passthrough for raw responses). */
function toResponse(result: unknown, requestId: string): NextResponse {
  if (result instanceof NextResponse) return result;
  const { body, status } = discordSuccessBody(result, requestId);
  return NextResponse.json(body, { status });
}

function toErrorResponse(err: unknown, requestId: string): NextResponse {
  const apiErr =
    err instanceof DiscordApiError
      ? err
      : new DiscordApiError("INTERNAL", "Unexpected server error.");
  if (!(err instanceof DiscordApiError)) {
    console.error("[discord route] unhandled error:", err);
  }
  const { body, status } = discordErrorBody(apiErr, requestId);
  return NextResponse.json(body, { status });
}

/**
 * Wrap a handler that only needs the global Bearer (outbox pull, heartbeat).
 * Org is read from the header if present but not verified by HMAC.
 */
export function withBotAuth<P = undefined>(
  handler: (ctx: BotRouteContext<P>) => Promise<unknown>,
): (...args: NextRouteArgs<P>) => Promise<NextResponse> {
  return async (...args: NextRouteArgs<P>) => {
    const requestId = newRequestId();
    const request = args[0];
    try {
      requireBotToken(request);
      const params = await resolveParams(args);
      const organizationId = request.headers.get(DISCORD_ORG_HEADER);
      const result = await handler({ request, requestId, organizationId, params });
      return toResponse(result, requestId);
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}

/**
 * Wrap a handler behind the full per-org trust boundary. Verifies the Bearer,
 * loads the org's enabled `DiscordIntegration`, verifies the HMAC over the raw
 * body, parses JSON, and resolves the actor (may be null — routes that require a
 * link call `requireLinkedActor`).
 */
export function withDiscordAuth<P = undefined>(
  handler: (ctx: DiscordRouteContext<P>) => Promise<unknown>,
): (...args: NextRouteArgs<P>) => Promise<NextResponse> {
  return async (...args: NextRouteArgs<P>) => {
    const requestId = newRequestId();
    const request = args[0];
    try {
      requireBotToken(request);

      const organizationId = request.headers.get(DISCORD_ORG_HEADER);
      if (!organizationId) {
        throw new DiscordApiError("VALIDATION", `Missing ${DISCORD_ORG_HEADER} header.`);
      }

      const integration = await prisma.discordIntegration.findUnique({
        where: { organizationId },
      });
      if (!integration?.isEnabled) {
        throw new DiscordApiError(
          "ORG_NOT_CONFIGURED",
          "No enabled Discord integration for this organisation.",
        );
      }

      const rawBody = await request.text();
      const verify = verifyDiscordRequest(
        rawBody,
        request.headers.get(DISCORD_SIG_HEADER),
        request.headers.get(DISCORD_TS_HEADER),
        integration.signingSecret,
      );
      if (!verify.valid) {
        throw new DiscordApiError(
          "SIGNATURE_INVALID",
          `Request signature ${verify.reason ?? "invalid"}.`,
        );
      }

      let json: unknown = undefined;
      if (rawBody.length > 0) {
        try {
          json = JSON.parse(rawBody);
        } catch {
          throw new DiscordApiError("VALIDATION", "Request body is not valid JSON.");
        }
      }

      const actorDiscordId = request.headers.get(DISCORD_ACTOR_HEADER);
      const actor = actorDiscordId
        ? await resolveDiscordActor(organizationId, actorDiscordId)
        : null;

      const result = await handler({
        request,
        requestId,
        organizationId,
        rawBody,
        json,
        actor,
        actorDiscordUserId: actorDiscordId,
        idempotencyKey: request.headers.get("idempotency-key"),
        params: await resolveParams(args),
      });
      return toResponse(result, requestId);
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}

/** Assert a route has a linked actor; throws NOT_LINKED otherwise. Narrows the type. */
export function requireLinkedActor(ctx: DiscordRouteContext<unknown>): ServiceActor {
  if (!ctx.actor) {
    throw new DiscordApiError("NOT_LINKED", "This Discord account is not linked to GearFlow.");
  }
  return ctx.actor;
}
