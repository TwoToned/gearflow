import { ConvexHttpClient } from "convex/browser";
import { env } from "@/env";

/**
 * Server-side Convex client (Phase 3 of the Convex migration).
 *
 * Used by server actions, scripts, and webhooks to call Convex queries/mutations
 * over HTTP. Convex functions are public + unauthed (trust is delegated to the
 * caller — see convex/README.md and FEATUREDOCS/54), so no admin token is needed
 * to invoke them; the admin key is only for `convex deploy`/dashboard.
 *
 * Server-side only (reads env, holds no per-request state). The browser never
 * imports this — it talks to Convex reactively via ConvexClientProvider +
 * useQuery instead. (No `import "server-only"` so scripts/tsx can use it too.)
 */
let client: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  if (!client) {
    const url = env.CONVEX_SELF_HOSTED_URL ?? env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error(
        "Convex is not configured — set CONVEX_SELF_HOSTED_URL (or NEXT_PUBLIC_CONVEX_URL).",
      );
    }
    client = new ConvexHttpClient(url);
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
