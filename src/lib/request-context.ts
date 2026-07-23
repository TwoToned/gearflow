import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient request id (POLICY.md R-8.9.5) — the correlation id minted/forwarded by
 * `middleware.ts` as `x-request-id`.
 *
 * Mirrors the ActorContext pattern in `request-actor.ts`: rather than threading a
 * `requestId` argument through every `logger.*` call site (hundreds of them), the
 * request entry point (`withValidatedBody`, `onRequestError`) runs the rest of the
 * request inside {@link runWithRequestId}, and `logger.ts` reads the ambient value
 * automatically via {@link getAmbientRequestId}. Plain `next/headers` `headers()`
 * can't serve this role — it's async in the App Router, and `logger.emit` is
 * synchronous — so this uses the same `node:async_hooks` seam as the actor context.
 *
 * Anything running outside `runWithRequestId` (a cron/script/background job with no
 * inbound request) sees `undefined` and logs without a requestId, unchanged.
 */
const requestIdStorage = new AsyncLocalStorage<string>();

/** Run `fn` with `requestId` as the ambient correlation id for its entire async subtree. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIdStorage.run(requestId, fn);
}

/** The ambient request id, or undefined when running outside a tracked request. */
export function getAmbientRequestId(): string | undefined {
  return requestIdStorage.getStore();
}
