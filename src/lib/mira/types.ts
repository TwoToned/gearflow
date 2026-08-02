/**
 * Shared Mira types with no runtime dependencies — split out so both the
 * client provider (mira-context-provider.tsx) and the server-side agent loop
 * can import `MiraPageContext` without pulling in server-only code.
 */
export interface MiraPageContext {
  /** What kind of entity the user is currently looking at, e.g. "project". */
  entityType?: string;
  /** That entity's id, e.g. a project cuid. */
  entityId?: string;
  [key: string]: unknown;
}
