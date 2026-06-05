/**
 * Runtime database URL hardening.
 *
 * The bare `DATABASE_URL` runs on Prisma defaults: a tiny connection pool
 * (cpus * 2 + 1) and — critically — NO `statement_timeout`, so a single slow
 * query can hold a pooled connection indefinitely. Under that shape one
 * pathological query plan saturates the pool and stalls the WHOLE app until it
 * clears (observed in prod as intermittent ~1-minute, app-wide freezes after a
 * bulk backfill left the planner on stale statistics).
 *
 * `buildRuntimeDatabaseUrl` layers safe, env-overridable connection params onto
 * the URL the app's PrismaClient connects with:
 *   - statement_timeout  — server-side cap so no query holds a connection
 *                          hostage; bounds the blast radius of a bad plan to a
 *                          single request instead of the whole pool.
 *   - pool_timeout       — a request waiting for a free connection fails fast
 *                          instead of piling up behind a slow one.
 *   - connection_limit   — only applied when explicitly configured; otherwise
 *                          Prisma's cpu-based default stands (right for the box).
 *
 * Anything already present in the env URL WINS — the operator can always
 * override per-environment. This is applied ONLY to the app's runtime client,
 * NOT to `prisma migrate` (which reads the raw env var via the CLI), so heavy
 * backfill migrations are never killed by the timeout.
 */

export interface RuntimeDbOptions {
  /** Per-query server-side timeout in ms. 0 / undefined disables (not recommended). */
  statementTimeoutMs?: number;
  /** Seconds a checkout waits for a free pooled connection before erroring. */
  poolTimeoutS?: number;
  /** Max pooled connections. Undefined leaves Prisma's cpu-based default. */
  connectionLimit?: number;
}

export function buildRuntimeDatabaseUrl(raw: string, opts: RuntimeDbOptions): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a parseable URL (e.g. a libpq keyword/value string) — leave untouched
    // rather than risk corrupting an exotic connection string.
    return raw;
  }

  const sp = url.searchParams;

  if (opts.connectionLimit != null && !sp.has("connection_limit")) {
    sp.set("connection_limit", String(opts.connectionLimit));
  }

  if (opts.poolTimeoutS != null && !sp.has("pool_timeout")) {
    sp.set("pool_timeout", String(opts.poolTimeoutS));
  }

  if (opts.statementTimeoutMs != null && opts.statementTimeoutMs > 0) {
    // libpq `options` is a space-separated list of `-c key=val`. Append our
    // setting only if the operator hasn't already specified a statement_timeout.
    const existing = sp.get("options") ?? "";
    if (!/statement_timeout/i.test(existing)) {
      const addition = `-c statement_timeout=${opts.statementTimeoutMs}`;
      sp.set("options", existing ? `${existing} ${addition}` : addition);
    }
  }

  url.search = sp.toString();
  return url.toString();
}
