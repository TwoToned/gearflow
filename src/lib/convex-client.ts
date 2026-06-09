import { ConvexHttpClient } from "convex/browser";
import { env } from "@/env";
import { getConvexServiceToken } from "./convex-auth";

/**
 * Server-side Convex client (Phase 3 of the Convex migration; Phase 5 auth bridge).
 *
 * Used by server actions, scripts, and webhooks to call Convex queries/mutations
 * over HTTP. Since Phase 5 every Convex function requires a valid token; this
 * client attaches the SERVICE token (see src/lib/convex-auth.ts), which identifies
 * the caller as the trusted GearFlow backend. The server action still does all
 * authorization (requirePermission/validation/logActivity) before calling Convex.
 *
 * The service identity is process-global, so a single ConvexHttpClient with the
 * service token attached is safe to share (no per-user identity to leak). The
 * token is re-attached whenever it nears expiry. `getConvexClient()` is async
 * because minting/refreshing the token is async.
 *
 * Server-side only (reads env + the Better Auth signer). The browser never imports
 * this — it talks to Convex reactively via ConvexClientProvider + useQuery, using
 * its own USER token. (No `import "server-only"` so scripts/tsx can use it too.)
 */
let client: ConvexHttpClient | null = null;
let attachedToken: string | null = null;

export async function getConvexClient(): Promise<ConvexHttpClient> {
  if (!client) {
    const url = env.CONVEX_SELF_HOSTED_URL ?? env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error(
        "Convex is not configured — set CONVEX_SELF_HOSTED_URL (or NEXT_PUBLIC_CONVEX_URL).",
      );
    }
    client = new ConvexHttpClient(url);
  }
  const token = await getConvexServiceToken();
  if (token !== attachedToken) {
    client.setAuth(token);
    attachedToken = token;
  }
  return client;
}

/**
 * Map a Prisma row to a Convex create payload: Date -> Unix ms, Prisma Decimal
 * -> number, and null -> undefined (Convex `v.optional()` rejects null — a field
 * is either present-with-a-value or absent). Use when backfilling or mirroring.
 */
export function toConvexValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  // Prisma Decimal exposes toNumber(); duck-type it without importing the type.
  if (typeof value === "object" && value !== null && "toNumber" in value && typeof (value as { toNumber: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  return value;
}

/** Apply toConvexValue across an object, dropping keys that become undefined. */
export function toConvexDoc<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(row)) {
    const mapped = toConvexValue(val);
    if (mapped !== undefined) out[k] = mapped;
  }
  return out;
}
