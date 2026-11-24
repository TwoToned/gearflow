/**
 * Two client rules, one per question (UX Phase 11 review):
 *
 * - `reachesResource` — can this role SEE the place? Any action on the resource.
 *   NAV visibility (`nav.ts`: a gated item is absent, never greyed), Home's
 *   `View all ›` / line targets (`canOpenLink`) and the ⌘K palette's Actions ask
 *   it (`reports` grants `view`, not `read`; a role may hold `create` alone).
 * - `canReadResource` — may this role's DATA be read? The `read` action itself.
 *   Every client-side gate in front of a data read asks this one (Needs attention's
 *   reads, the More sheet's counts, the palette's day-jobs read), so a role holding
 *   only `create` never fires a read the server would refuse.
 *
 * The server still decides what a read returns.
 */
export type PermissionMapLike = Partial<Record<string, readonly string[]>>;

/** Any action on `resource`. Unknown permissions (still loading) = no. */
export function reachesResource(permissions: PermissionMapLike | null | undefined, resource: string): boolean {
  return (permissions?.[resource]?.length ?? 0) > 0;
}

/** The `read` action on `resource`, the gate for a data read. Unknown permissions (still loading) = no. */
export function canReadResource(permissions: PermissionMapLike | null | undefined, resource: string): boolean {
  return permissions?.[resource]?.includes("read") ?? false;
}
