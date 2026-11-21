/**
 * The human sentence for a failed Packing write. The server throws
 * `ConvexError({ code, message })` and the message already says what to do
 * (`CASE_SEALED`: "LX-04 is sealed. Unseal it to plan lines into it.";
 * `NOT_EMPTY`: "This container still has items packed inside it…"), so the toast
 * shows the server's own words rather than a second hand-kept copy (R-3.1).
 */
function errorData(e: unknown): unknown {
  return (e as { data?: unknown } | null)?.data;
}

function field(data: unknown, key: "message"): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

export function packingWriteMessage(e: unknown, fallback = "That didn't save"): string {
  const data = errorData(e);
  const fromData = typeof data === "string" && data ? data : field(data, "message");
  if (fromData) return fromData;
  const own = e instanceof Error ? e.message : "";
  return own && !own.startsWith("[CONVEX") ? own : fallback;
}
