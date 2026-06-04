/**
 * HMAC-signing client for src/app/api/discord/v1/*. Parses the standard envelope
 * `{ ok, data | error:{code,...}, meta }` and throws a BotError on failure so
 * command code can `try/catch` and the runner renders the right Discord copy.
 *
 * `fetchImpl` is injectable so commands are testable with a stubbed fetch.
 */
import crypto from "node:crypto";
import { BotError, type BotErrorCode } from "./errors.js";

export interface ApiClientConfig {
  baseUrl: string; // e.g. https://home.twotoned.com.au
  signingSecret: string; // per-org DiscordIntegration.signingSecret
  botToken: string; // global DISCORD_BOT_TOKEN bearer
  organizationId: string; // scopes every request
  /** Invoking Discord user — the app resolves the actor + role from this server-side. */
  actorDiscordUserId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number; // unix seconds, injectable for tests
}

const SIG_HEADER = "x-gearflow-signature";
const TS_HEADER = "x-gearflow-timestamp";
const ORG_HEADER = "x-gearflow-org";
const ACTOR_HEADER = "x-gearflow-actor-discord-id";

interface ErrorEnvelope {
  ok: false;
  error: { code: BotErrorCode; message: string; retryable?: boolean; details?: Record<string, unknown> };
}
interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

export class GearFlowApiClientImpl {
  constructor(private readonly cfg: ApiClientConfig) {}

  private sign(rawBody: string, ts: number): string {
    return crypto.createHmac("sha256", this.cfg.signingSecret).update(`${ts}.${rawBody}`).digest("base64");
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const f = this.cfg.fetchImpl ?? fetch;
    const ts = (this.cfg.now ?? (() => Math.floor(Date.now() / 1000)))();
    const rawBody = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.cfg.botToken}`,
      [ORG_HEADER]: this.cfg.organizationId,
      [TS_HEADER]: String(ts),
      [SIG_HEADER]: this.sign(rawBody, ts),
    };
    if (this.cfg.actorDiscordUserId) headers[ACTOR_HEADER] = this.cfg.actorDiscordUserId;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const res = await f(`${this.cfg.baseUrl}/api/discord/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : rawBody,
    });

    const json = (await res.json()) as ErrorEnvelope | SuccessEnvelope<T>;
    if (!json.ok) {
      throw new BotError(json.error.code, json.error.message, {
        retryable: json.error.retryable,
        details: json.error.details,
      });
    }
    return json.data;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T = unknown>(path: string, body: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
    return this.request<T>("POST", path, body, opts?.idempotencyKey);
  }
}
