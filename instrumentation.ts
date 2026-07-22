// Loaded by Next.js once per server start.
// See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Last-resort net: log + report stray unhandled rejections / uncaught
    // exceptions instead of letting them silently kill the process (the
    // intermittent-502 failure mode). See src/lib/process-safety.ts.
    const { installProcessSafetyNet } = await import("./src/lib/process-safety");
    installProcessSafetyNet("web");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

import { captureRequestError } from "@sentry/nextjs";
import type { Instrumentation } from "next";

/**
 * Forward server-side request errors to BOTH Sentry and PostHog Error Tracking
 * during the migration (#650). Sentry is removed once PostHog capture is
 * confirmed in prod. PostHog capture is dynamically imported so it never loads
 * in the edge runtime (posthog-node is Node-only).
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  captureRequestError(err, request, context);
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { captureServerException } = await import("./src/lib/posthog-server");
      await captureServerException(err, {
        route: context.routePath ?? "",
        method: request.method ?? "",
      });
    } catch {
      // reporting must never crash the handler
    }
  }
};
