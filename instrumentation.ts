// Loaded by Next.js once per server start.
// See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Last-resort net: log + report stray unhandled rejections / uncaught
    // exceptions instead of letting them silently kill the process (the
    // intermittent-502 failure mode). See src/lib/process-safety.ts.
    const { installProcessSafetyNet } = await import("./src/lib/process-safety");
    installProcessSafetyNet("web");

    // Auto-thread the x-request-id correlation id (POLICY.md R-8.9.5) into every
    // logger.* call made within a request's async subtree, without touching each
    // call site. Node-only (async_hooks) — see src/lib/logger.ts for why this is
    // registered rather than statically imported there.
    const { getAmbientRequestId } = await import("./src/lib/request-context");
    const { setAmbientRequestIdGetter } = await import("./src/lib/logger");
    setAmbientRequestIdGetter(getAmbientRequestId);
  }
}

import type { Instrumentation } from "next";

/**
 * Best-effort opaque actor id for error context (POLICY.md R-8.9.4 — "opaque
 * internal user ID ... never name/email/phone"). `getSession()` reads
 * `next/headers` `headers()` internally, which Next.js keeps available inside
 * `onRequestError` for exactly this purpose. Never throws: an anonymous/public
 * request, or a session lookup racing process shutdown, must not block error
 * reporting.
 */
async function resolveActorIdForErrorContext(): Promise<string | undefined> {
  try {
    const { getSession } = await import("./src/lib/auth-server");
    const session = await getSession();
    return session?.user.id;
  } catch {
    return undefined;
  }
}

/**
 * Forward server-side request errors to PostHog Error Tracking. Dynamically
 * imported so it never loads in the edge runtime (posthog-node is Node-only).
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { captureServerException } = await import("./src/lib/posthog-server");
      const rawRequestId = request.headers["x-request-id"];
      const requestId = Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId;
      const actorId = await resolveActorIdForErrorContext();
      await captureServerException(err, {
        route: context.routePath ?? "",
        method: request.method ?? "",
        ...(requestId ? { requestId } : {}),
        ...(actorId ? { actorId } : {}),
      });
    } catch {
      // reporting must never crash the handler
    }
  }
};
