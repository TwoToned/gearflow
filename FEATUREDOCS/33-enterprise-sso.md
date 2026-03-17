# Enterprise SSO

## Overview
Per-organization SAML 2.0 and OIDC Single Sign-On via the `@better-auth/sso` plugin. Each org can configure one or more identity providers, control how new users are provisioned, and map IdP groups to GearFlow roles.

## Architecture

### Plugin Stack
- **Server**: `sso()` plugin in `src/lib/auth.ts` with `provisionUser` hook
- **Client**: `ssoClient()` in `src/lib/auth-client.ts`
- **Account Linking**: `accountLinking: { enabled: true, trustedProviders: ["sso"] }` — auto-links existing users by email

### Database Tables
- `sso_provider` — Managed by Better Auth SSO plugin; mapped in Prisma as `SSOProvider` for type-safe queries
- `pending_sso_approval` — `PendingSSOApproval` model for require-approval provisioning mode
- `custom_role.ssoGroupClaim` — Optional field on custom roles for IdP group matching

### SSO Settings Storage
Stored as JSON in `Organization.metadata.sso` (type: `OrgSSOSettings` from `src/lib/sso-types.ts`).

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/sso-types.ts` | `OrgSSOSettings`, `SSOGroupMapping`, `DEFAULT_SSO_SETTINGS` |
| `src/lib/sso-provisioning.ts` | `handleSSOProvisioning` — provisionUser hook logic |
| `src/server/sso.ts` | Server actions: settings CRUD, provider management, approvals |
| `src/app/(app)/settings/sso/page.tsx` | SSO settings page (6 sections) |
| `src/components/settings/sso-*.tsx` | SSO settings sub-components |
| `src/app/(auth)/login/[orgSlug]/` | Org-specific login page |
| `src/app/(auth)/pending-approval/page.tsx` | Pending approval page |
| `src/app/api/auth/sso/org-lookup/route.ts` | Email domain → org lookup API |
| `src/lib/validations/sso.ts` | Zod schemas for SSO forms |

## SSO Settings (`OrgSSOSettings`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Master SSO toggle |
| `provisioningMode` | enum | `AUTO_CREATE` | How new SSO users are handled |
| `defaultRole` | string | `member` | Fallback role when no group mapping matches |
| `roleSyncBehavior` | enum | `SYNC_ON_LOGIN` | When roles are updated from IdP groups |
| `allowPasswordLogin` | boolean | `true` | Allow email/password alongside SSO |
| `enforceSSO` | boolean | `false` | Require SSO (blocks password/social login) |
| `ssoTestedSuccessfully` | boolean | `false` | Must be true before `enforceSSO` can be enabled |
| `groupMappings` | array | `[]` | IdP group → GearFlow role mappings |
| `oidcGroupsClaim` | string | `groups` | OIDC token claim name for groups |
| `samlGroupsAttribute` | string | `groups` | SAML assertion attribute for groups |
| `groupValueType` | enum | `name` | Match groups by `name` or `id` |

## Provisioning Modes

### AUTO_CREATE
User is created as org member immediately on first SSO login with the resolved role.

### REQUIRE_APPROVAL
Creates a `PendingSSOApproval` record. User can authenticate but has no org membership until an admin approves in `/settings/sso`. Approved users get an email notification.

### EXISTING_ONLY
Only existing org members can sign in via SSO. New users get an error. Useful for orgs that manage membership manually.

## Group-to-Role Resolution

Priority order (in `resolveRoleFromGroups`):
1. **Custom roles with `ssoGroupClaim`**: If any custom role in the org has a `ssoGroupClaim` value matching one of the user's IdP groups, that custom role is assigned.
2. **Explicit group mappings**: Checked from the `groupMappings` array in SSO settings. Custom role mappings take priority, then highest-privilege built-in role wins.
3. **Default role**: Falls back to `defaultRole` if no mappings match.

### Role Sync Behavior
- **SYNC_ON_LOGIN**: Role is re-evaluated from IdP groups on every SSO login
- **INITIAL_ONLY**: Role is set on first login, never changed automatically
- **MANUAL_ONLY**: Group mappings are ignored; admins assign roles manually

## Login Flow

### Global Login (`/login`)
1. User enters email → "Continue"
2. System checks `/api/auth/sso/org-lookup` for domain match
3. If single org match → redirect to `/login/{orgSlug}`
4. If multiple matches → show org picker
5. If no match → show password form

### Org Login (`/login/[orgSlug]`)
- Prominent SSO button(s) at top (primary style, h-14)
- "Other sign-in options" divider
- Social login buttons (if not enforcing SSO)
- Email/password form (if `allowPasswordLogin` and not enforcing SSO)
- SSO button calls `authClient.signIn.sso({ providerId, callbackURL: "/dashboard" })`

### Post-Login
- `handlePostLogin` checks org membership
- If no membership → redirect to `/pending-approval`
- If member → set active org → redirect to `/dashboard`

## Settings UI (`/settings/sso`)

Six card sections:
1. **SSO Status** — Enable toggle + org login URL with copy button
2. **Identity Providers** — Provider list + "Add Provider" dialog (OIDC/SAML tabs)
3. **User Provisioning** — Radio group for 3 modes + default role dropdown
4. **Group-to-Role Mapping** — Role sync behavior + claim config + mapping table
5. **Login Behaviour** — Allow password toggle + enforce SSO toggle (requires test login)
6. **Pending Approvals** — Table with approve/reject (only shown when mode is REQUIRE_APPROVAL)

## Server Actions (`src/server/sso.ts`)

| Action | Auth | Purpose |
|--------|------|---------|
| `getSSOSettings()` | `getOrgContext()` | Read SSO config from metadata |
| `updateSSOSettings(data)` | `requirePermission("orgSettings", "update")` | Update SSO config |
| `getSSOProviders()` | `getOrgContext()` | List providers (secrets sanitized) |
| `deleteSSOProvider(id)` | `requirePermission("orgSettings", "update")` | Delete provider |
| `updateGroupMappings(mappings)` | `requirePermission("orgSettings", "update")` | Update mappings |
| `getPendingApprovals()` | `getOrgContext()` | List pending approvals |
| `approveSSOUser(id, role?)` | `requirePermission("orgMembers", "create")` | Approve + create member |
| `rejectSSOUser(id, note?)` | `requirePermission("orgMembers", "create")` | Reject + email |
| `updateSSOProviderMeta(id, meta)` | `requirePermission("orgSettings", "update")` | Update provider display name/icon |
| `patchProviderOidcConfig(id, patch)` | `requirePermission("orgSettings", "update")` | Direct DB patch for ID token mode |
| `getOrgLoginInfo(orgSlug)` | None (public) | Org info for login page |

## Provider Registration
SSO provider CRUD uses Better Auth's built-in API endpoints from the client (`authClient.sso.register()`), not server actions. SP Metadata (ACS URL, Metadata URL, OIDC Redirect) is displayed in the provider form for IdP configuration.

Provider editing uses `updateBetterAuthProvider()` helper (calls `/api/auth/sso/update-provider`) for issuer, domain, secrets, and claim mapping. Display metadata (name, icon) is stored separately in org metadata via `updateSSOProviderMeta()`.

## OIDC Claim Mapping & ID Token Mode

### Email Claim Override
Some IdPs (notably Microsoft Entra) don't include the standard `email` claim in their userinfo endpoint or ID token. The provider edit form exposes an **Email Claim** field that maps to Better Auth's `oidcConfig.mapping.email`. Common values:
- `email` (default) — standard OIDC claim
- `preferred_username` — used by Microsoft Entra (recommended for Entra setups)
- `upn` — Azure AD User Principal Name (ID token only)

### Forced ID Token Mode
All OIDC providers are automatically configured to use **ID token claims only** (via `patchProviderOidcConfig`). This removes the `userInfoEndpoint` from the stored config so Better Auth reads claims from the ID token instead of calling the userinfo endpoint. This is applied:
- On new provider registration (after `authClient.sso.register()`)
- On every provider edit save

**Why**: The userinfo endpoint is unreliable across IdPs — Microsoft Entra's Graph-based endpoint (`https://graph.microsoft.com/oidc/userinfo`) uses different claim names than the ID token and often doesn't return email for non-admin users. The ID token always contains the claims configured in the IdP.

**Technical detail**: Better Auth's `needsRuntimeDiscovery()` checks for `tokenEndpoint`, `jwksEndpoint`, and `authorizationEndpoint`. If all three exist, OIDC discovery is skipped and the stored config (without `userInfoEndpoint`) is used as-is.

## Auto-Discovery of IdP Groups

When a user signs in via SSO, the `handleSSOProvisioning` hook automatically discovers new IdP groups. Groups not already in the org's group mappings are added with `unmapped: true` and an empty `gearflowRole`. This lets admins see which groups exist in the IdP before mapping them to roles.

In the settings UI, unmapped groups appear with an amber radar icon. Assigning a role and saving clears the `unmapped` flag.

## Provider Display Metadata

Each provider can have a display name and brand icon, stored in `Organization.metadata.sso.providerMeta[providerId]`. These are shown on:
- The org login page SSO button
- The settings provider list row

Icons are defined in `src/lib/sso-icons.tsx` with support for Microsoft, Google, Okta, OneLogin, Auth0, Duo, JumpCloud, PingIdentity, Authentik, and a generic Key fallback.

## Microsoft Entra Setup Notes

1. **App Registration**: Create an app in Azure Portal → App Registrations
2. **Redirect URI**: Add `{APP_URL}/api/auth/sso/callback/{providerId}` as a Web redirect
3. **API Permissions**: openid, email, profile (admin consent recommended)
4. **Optional Claims**: Add `preferred_username` to the ID token
5. **Email Claim**: Set to `preferred_username` in the GearFlow provider edit form
6. **ID Token Mode**: Automatically enabled — no action needed
7. **Groups**: Configure group claims in Token Configuration to enable group-to-role mapping

## Environment Variables

No new environment variables are required for SSO. The feature uses:
- `BETTER_AUTH_URL` / `NEXT_PUBLIC_APP_URL` — for constructing callback URLs
- `BETTER_AUTH_SECRET` — already required for auth signing
- Provider credentials (client ID, client secret) are stored in the database per-provider
