/**
 * Single source of truth for "is this the site-admin role" (POLICY.md R-3.1).
 * Client-safe (no server-only imports) so both server code (admin-auth.ts)
 * and client components (user-nav, account page, admin users list) can share
 * it instead of re-declaring `role === "admin"`.
 */
export function isSiteAdminRole(role: string | null | undefined): boolean {
  return role === "admin";
}
