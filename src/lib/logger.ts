/**
 * Structured, levelled logger (POLICY.md R-8.9.5). Emits one JSON line per event so
 * logs are machine-parseable and levelled; a correlation/request id is attached when
 * provided (set by middleware as `x-request-id`, threaded via `meta.requestId`).
 *
 * Sensitive data MUST NOT be logged: keys matching SENSITIVE are redacted from `meta`
 * (defence-in-depth on top of not passing PII in the first place). Covered by
 * logger.test.ts.
 */
type Level = "debug" | "info" | "warn" | "error";

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
