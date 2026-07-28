import { ConvexHttpClient } from "convex/browser";
import { env } from "@/env";
import { withConvexOpTiming } from "../convex-op-timing";
import { mintAgentToken, type AgentTokenKey } from "./agent-token";

/**
 * A Convex client bound to a per-request AGENT token.
 *
 * Deliberately NOT the shared `getConvexClient()` singleton. That one carries the
 * process-global SERVICE identity, which is safe to share precisely because it has
 * no per-user identity; an agent token DOES carry one (the key's acting user), so
 * sharing a client across requests would create a cross-request auth race — two
 * concurrent API calls could execute under each other's identity. One client per
 * request, discarded with the request.
 *
 * Every call the API/MCP dispatcher makes on behalf of a key goes through here.
 * The dispatcher's own bookkeeping (the `apiIdempotency` ledger, the per-key
 * request log) keeps using the service client — that infrastructure is not
 * agent-addressable by design.
 */
export async function createAgentConvexClient(
  key: AgentTokenKey,
): Promise<ConvexHttpClient> {
  const url = env.CONVEX_SELF_HOSTED_URL ?? env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error(
      "Convex is not configured — set CONVEX_SELF_HOSTED_URL (or NEXT_PUBLIC_CONVEX_URL).",
    );
  }
  const client = withConvexOpTiming(new ConvexHttpClient(url));
  client.setAuth(await mintAgentToken(key));
  return client;
}
