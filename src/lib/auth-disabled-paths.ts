/**
 * Better Auth organization endpoints the app does NOT use, switched off with
 * `disabledPaths` (a 404 from Better Auth's own `onRequest`, before any session
 * or database work). Why: the stock `organization()` plugin exposes member and
 * invitation WRITES behind its own default access control, which knows nothing
 * of this app's role policy (`member-role-policy.ts`). With the default `adminAc`
 * (`member: [create, update, delete]`, `invitation: [create, cancel]`,
 * `organization: [update]`) an Admin session could call them directly and: promote
 * a member to admin or demote another admin (`update-member-role`: only the OWNER
 * is protected; compound roles like `admin,member` are accepted), remove another
 * admin (`remove-member`), invite as admin (`invite-member`), or rename/re-slug
 * the org outside the gated settings action (`update`). Those writes also bypass
 * the Convex member mirror (RBAC reads it) and the activity log. The app's own
 * gated server actions (`src/server/team.ts`, `settings.ts`) are the only writers.
 *
 * Endpoint inventory for better-auth 1.7.14 (`/organization/*`):
 *
 * DISABLED (writes the app never calls):
 *   update-member-role, remove-member, invite-member, cancel-invitation, add-member
 *   (server-only API, listed defensively), reject-invitation, update, delete, leave
 *   (a member write with no mirror to Convex), create-role/update-role/delete-role
 *   (dynamic access control; not enabled, listed defensively), and the team
 *   endpoints (teams not enabled; listed defensively).
 * KEPT (the app calls them, or they are read-only and session-scoped):
 *   create (setup flow; gated by allowUserToCreateOrganization + beforeCreateOrganization),
 *   set-active (org switcher/login), accept-invitation (invite page; the invitation's
 *   role can only come from the gated invite path, and `beforeAcceptInvitation` refuses
 *   any role that is not exactly an assignable role), list + get-full-organization
 *   (`useListOrganizations` / `useActiveOrganization`), get-organization, check-slug
 *   (read-only boolean, session required), has-permission, get-active-member,
 *   get-active-member-role, list-members, list-invitations, list-user-invitations,
 *   get-invitation, list-roles, get-role (reads).
 *
 * Adding an endpoint to the kept list means: no write, or the write goes through
 * the role policy. `auth-disabled-paths.test.ts` drives the real handler.
 */
export const DISABLED_AUTH_PATHS = [
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/add-member",
  "/organization/reject-invitation",
  "/organization/update",
  "/organization/delete",
  "/organization/leave",
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
  "/organization/create-team",
  "/organization/update-team",
  "/organization/remove-team",
  "/organization/set-active-team",
  "/organization/add-team-member",
  "/organization/remove-team-member",
] as const;

/** The org endpoints the app and its read-only hooks keep using. */
export const KEPT_AUTH_PATHS = [
  "/organization/create",
  "/organization/set-active",
  "/organization/accept-invitation",
  "/organization/list",
  "/organization/get-full-organization",
] as const;
