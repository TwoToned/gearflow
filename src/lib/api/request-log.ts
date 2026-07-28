import { api } from "../../../convex/_generated/api";
import { getConvexClient } from "../convex-client";
import { redactArgs } from "./request-log-redact";
import { logger } from "../logger";

export interface RequestLogEntry {
  organizationId: string;
  apiKeyId: string;
  ts: number;
  operation: string;
  kind: "query" | "mutation";
  status: "success" | "error";
  errorCode?: string | null;
  missingScope?: string | null;
  latencyMs: number;
  requestId?: string | null;
  args: Record<string, unknown>;
}

/**
 * Write one row to the per-key API request log. Redacts `args` before they
 * leave process memory (R-8.12.4) — the dispatcher must never pass raw args
 * here. Best-effort: a logging failure must not fail the request it's
 * describing, so this swallows its own errors after a console warning.
 */
export async function logApiRequest(entry: RequestLogEntry): Promise<void> {
  try {
    const client = await getConvexClient();
    await client.mutation(api.apiRequestLog.logRequest, {
      organizationId: entry.organizationId,
      apiKeyId: entry.apiKeyId,
      ts: entry.ts,
      operation: entry.operation,
      kind: entry.kind,
      status: entry.status,
      errorCode: entry.errorCode ?? undefined,
      missingScope: entry.missingScope ?? undefined,
      latencyMs: entry.latencyMs,
      requestId: entry.requestId ?? undefined,
      argsRedacted: redactArgs(entry.args),
    });
  } catch (err) {
    logger.warn("[api-request-log] failed to write log row", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Spend one `agentRead` token for this key. Convex queries can't write, so this
 *  runs as a service-authenticated mutation before the dispatcher mints the
 *  caller's agent token and runs the actual read (rateLimiter.ts). */
export async function spendAgentReadLimit(apiKeyId: string): Promise<void> {
  const client = await getConvexClient();
  await client.mutation(api.apiRequestLog.spendReadLimit, { apiKeyId });
}
