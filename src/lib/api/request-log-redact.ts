/**
 * PII/secret redaction for the per-key API request log (POLICY.md R-8.12.4,
 * docs/pii-inventory.md). The log exists for operators to debug their own
 * integration (`ts, operation, status, error code, missing scope, latency,
 * requestId`) — it is not a raw request capture, so business-sensitive field
 * VALUES never reach `apiRequestLog.argsRedacted`, only which fields were sent
 * and their shape.
 *
 * Field-name list sourced from docs/pii-inventory.md's PII table (crew/client/
 * supplier contact + identity fields) plus generic secret-shaped names. Keep
 * the two in sync — a new PII field there should be added here too.
 */

const REDACTED_FIELD_NAMES = new Set(
  [
    "name", "firstName", "lastName", "email", "emailVerified", "phone", "image",
    "address", "notes", "internalNotes", "emergencyContactName", "emergencyContactPhone",
    "dateOfBirth", "abnOrGst", "latitude", "longitude",
    "token", "password", "secret", "apiKey", "authorization", "icalToken",
    "ipAddress", "userAgent", "ssn", "creditCard",
  ].map((f) => f.toLowerCase()),
);

const REDACTED = "[redacted]";
const MAX_DEPTH = 3;
const MAX_ARRAY_ITEMS = 10;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (REDACTED_FIELD_NAMES.has(lower)) return true;
  return /token|password|secret|apikey|authorization|ssn|creditcard/i.test(key);
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return typeof value === "object" ? "[object]" : value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactValue(v, depth + 1));
    return value.length > MAX_ARRAY_ITEMS ? [...items, `…(+${value.length - MAX_ARRAY_ITEMS} more)`] : items;
  }
  if (typeof value === "object") {
    return redactArgs(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

/**
 * Redact one args object for storage. Keeps ids, enums, booleans, and numbers
 * (useful for debugging "which record, which status") — replaces
 * PII/secret-shaped VALUES with `"[redacted]"`, recursing a bounded depth so a
 * nested `fields`/`set` patch is scrubbed too, not just the top level.
 */
export function redactArgs(
  args: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, depth);
  }
  return out;
}
