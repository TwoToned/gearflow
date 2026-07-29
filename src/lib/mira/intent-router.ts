/**
 * Mira's question → MCP operation router (Phase 8, #1004).
 *
 * Deliberately a small, deterministic, keyword/page-context router — NOT an
 * LLM. Wiring Mira to a real language model is a separate, much larger
 * feature (a new model dependency, prompt design, cost/latency budget) that
 * this phase's scope ("wire Mira to the MCP surface so page context flows
 * into the agent's tool calls automatically") doesn't require: the point
 * here is the PLUMBING — that Mira is a real MCP/dispatch consumer, its
 * calls show up in the per-key request log, and page context (the entity the
 * user is currently looking at) narrows what it calls. Swap this router for
 * an LLM tool-use loop later without touching anything downstream of it —
 * `askMira` (src/server/mira.ts) only depends on this returning
 * `{ operation, args }`.
 *
 * Every operation named here is a real, agent-reachable, curated MCP
 * operation (see src/lib/api/mcp/curated-tool-defs.ts) — Mira never reaches
 * for anything outside that same first-party surface.
 */

export interface MiraPageContext {
  /** What kind of entity the user is currently looking at, e.g. "project". */
  entityType?: string;
  /** That entity's id, e.g. a project cuid. */
  entityId?: string;
  [key: string]: unknown;
}

export interface MiraRoute {
  operation: string;
  args: Record<string, unknown>;
}

const ASSET_KEYWORDS = /\b(asset|assets|equipment|gear|inventory)\b/i;

/**
 * Route one question to (at most) one curated operation call.
 *
 * Project-page context wins by default (a question asked while looking at a
 * project is almost always about THAT project) unless the question is
 * clearly about assets instead.
 */
export function routeMiraQuestion(question: string, pageContext: MiraPageContext | null): MiraRoute | null {
  const onProjectPage =
    pageContext?.entityType === "project" && typeof pageContext.entityId === "string" && pageContext.entityId.length > 0;

  if (onProjectPage && !ASSET_KEYWORDS.test(question)) {
    return { operation: "projectDetail.bundle", args: { projectId: pageContext!.entityId } };
  }
  if (ASSET_KEYWORDS.test(question)) {
    return { operation: "assets.list", args: {} };
  }
  return null;
}
