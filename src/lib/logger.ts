/**
 * Structured, levelled logger (POLICY.md R-8.9.5). Emits one JSON line per event so
 * logs are machine-parseable and levelled; a correlation/request id is attached when
 * provided (set by middleware as `x-request-id`), either explicitly via
 * `meta.requestId` or ambiently (see {@link setAmbientRequestIdGetter} below).
 *
 * Sensitive data MUST NOT be logged: keys matching SENSITIVE are redacted from `meta`
 * (defence-in-depth on top of not passing PII in the first place). Covered by
 * logger.test.ts.
 */
type Level = "debug" | "info" | "warn" | "error";

/**
 * Server-only ambient requestId source, registered by `instrumentation.ts` at
 * process start. Deliberately NOT a static import of `request-context.ts` — this
 * file is isomorphic (imported by "use client" code, e.g. posthog-provider.tsx),
 * and `request-context.ts` pulls in `node:async_hooks`, which cannot land in the
 * browser bundle. Registering a plain function keeps `logger.ts` free of any
 * Node-only import; on the client this just stays unset and `emit` falls back to
 * whatever `meta.requestId` was passed explicitly (usually nothing).
 */
let ambientRequestIdGetter: (() => string | undefined) | undefined;

/** Called once from `instrumentation.ts` (Node runtime only) to enable auto-threading. */
export function setAmbientRequestIdGetter(getter: () => string | undefined): void {
  ambientRequestIdGetter = getter;
}

const SENSITIVE =
  /(pass(word|phrase)?|secret|token|authorization|cookie|api[-_]?key|jwt|ssn|creditcard|email|phone|dateofbirth|dob|icaltoken)/i;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const record: Record<string, unknown> = { level, message, ts: new Date().toISOString() };
  if (meta && Object.keys(meta).length) {
    const scrubbed = scrub(meta) as Record<string, unknown>;
    if (scrubbed.requestId != null) record.requestId = scrubbed.requestId;
    record.meta = scrubbed;
  }
  // Explicit meta.requestId always wins; otherwise fall back to the ambient one
  // set by middleware + threaded via runWithRequestId (request-context.ts).
  if (record.requestId == null) {
    const ambient = ambientRequestIdGetter?.();
    if (ambient != null) record.requestId = ambient;
  }
  const line = JSON.stringify(record);
  // This IS the logger's transport; all other app logging must go through `logger.*`
  // (enforced by the no-console lint rule).
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};
