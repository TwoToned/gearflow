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

export { captureRequestError as onRequestError } from "@sentry/nextjs";
