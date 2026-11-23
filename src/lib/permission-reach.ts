/**
 * The ONE "can this role open it?" rule for the client (UX Phase 11 review): the
 * role holds ANY action on the resource. The shell's nav gating (`nav.ts`), Home's
 * `View all ›` and Needs attention lines (`canOpenLink`, `gated`) and the ⌘K
 * palette's Actions all ask it, so a link, a row and a read never disagree about
 * the same resource (`reports` grants `view`, not `read`; a test-only role may
 * hold `create` without `read`). The server still decides what a read returns.
 */
export type PermissionMapLike = Partial<Record<string, readonly string[]>>;

/** Any action on `resource`. Unknown permissions (still loading) = no. */
export function reachesResource(permissions: PermissionMapLike | null | undefined, resource: string): boolean {
  return (permissions?.[resource]?.length ?? 0) > 0;
}
