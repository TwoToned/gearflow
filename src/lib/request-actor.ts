import { AsyncLocalStorage } from "node:async_hooks";
import type { ActorContext } from "./actor-context";

/**
 * Ambient actor for non-session callers (the API + MCP layer).
 *
 * The web UI resolves its actor from the Better Auth cookie via `next/headers`.
 * An API key has no cookie, so instead of threading an `actor` argument through
 * all ~556 server actions, the API dispatcher runs the action inside
 * {@link runWithActor}. `getOrgContext()` and `requirePermission()` consult this
 * store BEFORE falling back to the session, so every existing server action —
 * reads and writes alike — runs unmodified on behalf of an API key, through the
 * exact same guards the UI uses.
 *
 * Because `AsyncLocalStorage` propagates across `await`, nested calls (a server
 * action calling another server action) inherit the same actor. Anything running
 * outside `runWithActor` (an RSC page render, a cron job, a script) sees an empty
 * store and takes the unchanged session path.
 *
 * NOTE: this is a Node `async_hooks` API. Any route that enters this path must
 * declare `export const runtime = "nodejs"`.
 *
 * See docs/designs/api-mcp-agent-access.md (§"ActorContext seam").
 */
const actorStorage = new AsyncLocalStorage<ActorContext>();

/** Run `fn` with `actor` as the ambient identity for its entire async subtree. */
export function runWithActor<T>(actor: ActorContext, fn: () => Promise<T>): Promise<T> {
  return actorStorage.run(actor, fn);
}

/** The ambient actor, or undefined when running outside an API request. */
export function getAmbientActor(): ActorContext | undefined {
  return actorStorage.getStore();
}
