import { betterAuth } from "better-auth";
import { organization, twoFactor, admin, jwt } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "@/env";
import { prisma } from "@/lib/prisma";
import { mirrorUserToConvex } from "@/lib/user-mirror";
import { sendEmail } from "./email";
import {
  invitationEmail,
  passwordResetEmail,
  verificationEmail,
} from "./email-templates";
import { getPlatformName } from "./platform";
import { getSiteSettingsFromConvex } from "./site-settings-read";
import { readOrgSettingsBlob, saveOrgSettings } from "./org-settings-read";
import { handleSSOProvisioning } from "./sso-provisioning";
import { CONVEX_JWT_AUDIENCE, USER_TOKEN_TTL, JWKS_ALG } from "./convex-auth-constants";
import { shouldUseSecureCookies } from "./cookie-security";
import { verifyOrgCreationCode } from "./org-creation-gate";
import { getAnyOrgForAudit } from "./audit-org";
import { logActivity } from "./activity-log";

/** Shared by `allowUserToCreateOrganization` and `beforeCreateOrganization`
 *  below — the one-time bootstrap (no org exists anywhere yet) always skips
 *  both the toggle and the signup code. */
async function isOrgCreationBootstrap(): Promise<boolean> {
  return !(await prisma.organization.findFirst({ select: { id: true } }));
}

/** Strips the one-time signup code out of the org's `metadata` before it's
 *  persisted — it's proof of authorization, not org data. Exported (only)
 *  for src/lib/auth.stripOrgCreationCode.test.ts — importing the full
 *  `betterAuth()` config to unit-test a pure helper is disproportionate. */
export function stripOrgCreationCode(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const { orgCreationCode: _unused, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Best-effort audit trail for a rejected org-creation attempt (invalid/missing
 *  signup code) — logActivity never throws, so this can't break the rejection. */
async function logRejectedOrgCreation(
  organizationName: string | undefined,
  user: { id: string; email?: string; name?: string },
): Promise<void> {
  const anyOrg = await getAnyOrgForAudit();
  if (!anyOrg) return;
  await logActivity({
    organizationId: anyOrg.id,
    userId: user.id,
    userName: user.name ?? user.email ?? user.id,
    action: "REJECT",
    entityType: "orgCreationAttempt",
    entityId: user.id,
    entityName: organizationName ?? "(unnamed)",
    summary: "Rejected organization creation — invalid or missing signup code",
  });
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  // Cookie security follows the SERVE url (NEXT_PUBLIC_APP_URL), not the issuer
  // (BETTER_AUTH_URL). Locally we serve over http (roger:3000) while the issuer
  // is https://preview.lab.rvlt.app for Convex — without this, Better Auth would
  // mark session cookies Secure and the browser would drop them over http,
  // breaking login (set-active → 401). Prod serves https, so cookies stay Secure.
  advanced: {
    useSecureCookies: shouldUseSecureCookies(env.NEXT_PUBLIC_APP_URL),
  },
  // Better Auth's own default is `enabled: isProduction` — no override needed
  // for real prod traffic. But the seeded e2e harness (docs/e2e-harness.md)
  // runs a prebuilt `next start` (NODE_ENV=production) to sidestep a `next
  // dev` crash class, which means the harness's several specs registering
  // users back-to-back now also trip Better Auth's production sign-up rate
  // limit (observed: 3 successful registrations, then a 429 on the 4th,
  // stalling the whole test on a swallowed submit with no visible error).
  // E2E_HARNESS is only ever set by scripts/e2e-harness-up.sh and the CI
  // harness job — never in a real deploy — so this can't relax production.
  rateLimit: {
    enabled: !process.env.E2E_HARNESS,
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: async () => {
        // Trust all SSO providers dynamically so account linking works with random provider IDs
        try {
          const providers = await prisma.ssoProvider.findMany({
            select: { providerId: true },
          });
          return providers.map((p) => p.providerId);
        } catch {
          // DB unavailable at build time — trust no providers (SSO will work at runtime)
          return [] as string[];
        }
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      const pName = await getPlatformName();
      await sendEmail({
        to: user.email,
        ...passwordResetEmail({ resetUrl: url, platformName: pName }),
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const pName = await getPlatformName();
      await sendEmail({
        to: user.email,
        ...verificationEmail({ verifyUrl: url, platformName: pName }),
      });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  plugins: [
    organization({
      // Phase B (#1067), B3 (#1095, D6): the one-time bootstrap (no
      // organization exists anywhere yet, src/app/(auth)/onboarding/page.tsx)
      // is always allowed with no code — nobody could know a signup code
      // before the first admin exists to set one. After bootstrap, creation
      // follows the site-admin `allowOrgCreation` toggle; the signup code
      // itself (if `orgCreationCodeEnabled`) is checked in
      // `beforeCreateOrganization` below, since this hook only receives
      // `user`, not the submitted form data.
      allowUserToCreateOrganization: async () => {
        if (await isOrgCreationBootstrap()) return true;
        const settings = await getSiteSettingsFromConvex();
        return settings.allowOrgCreation;
      },
      creatorRole: "owner",
      memberRoleHierarchy: ["owner", "admin", "manager", "member", "warehouse", "viewer"],
      sendInvitationEmail: async (data) => {
        const pName = await getPlatformName();
        const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${data.id}`;
        await sendEmail({
          to: data.email,
          ...invitationEmail({
            orgName: data.organization.name,
            role: data.role,
            acceptUrl: inviteUrl,
            platformName: pName,
          }),
        });
      },
      organizationHooks: {
        // Verifies the signup code submitted as `metadata.orgCreationCode` on
        // the `organization.create()` call — src/app/(auth)/onboarding/page.tsx,
        // reached via the "Set up a new company" card on /welcome (Phase B's
        // B1 fork screen, #1092). Strips the code out of `metadata` before
        // it's persisted on the org row either way: it's a one-time proof of
        // authorization, not org data.
        beforeCreateOrganization: async ({ organization, user }) => {
          if (await isOrgCreationBootstrap()) return;

          const submitted = (organization.metadata as Record<string, unknown> | undefined)
            ?.orgCreationCode;
          const code = typeof submitted === "string" ? submitted : undefined;
          const ok = await verifyOrgCreationCode(code, user.id);
          if (!ok) {
            await logRejectedOrgCreation(organization.name, user);
            throw new APIError("FORBIDDEN", {
              message: "A valid signup code is required to create an organization.",
            });
          }

          return {
            data: {
              ...organization,
              metadata: stripOrgCreationCode(organization.metadata),
            },
          };
        },
      },
    }),
    twoFactor({
      issuer: "RVLT Flow",
    }),
    admin(),
    passkey({
      rpID: env.PASSKEY_RP_ID,
      rpName: env.PLATFORM_NAME,
      origin: env.BETTER_AUTH_URL,
    }),
    sso({
      organizationProvisioning: {
        disabled: true, // We handle provisioning manually in provisionUser
      },
      provisionUser: handleSSOProvisioning,
      trustEmailVerified: true, // Trust email_verified from IdPs for account linking
      saml: {
        enableInResponseToValidation: true,
        allowIdpInitiated: false,
      },
    }),
    // Convex auth bridge (Phase 5). Mints ES256 JWTs the self-hosted Convex
    // backend validates via its customJwt provider. Two token shapes share this
    // one signer/JWKS:
    //   • USER token  — GET /api/auth/token (session-gated). Carries orgId/role
    //     from a FRESH membership read; grants org-scoped reads in Convex.
    //   • SERVICE token — auth.api.signJWT() in-process (no HTTP route); carries
    //     svc:true; grants the trusted backend full access.
    // ES256 (not Better Auth's default EdDSA) because Convex customJwt accepts
    // only RS256/ES256.
    jwt({
      jwks: {
        keyPairConfig: { alg: JWKS_ALG },
      },
      // Don't sign a JWT on every /get-session — the browser fetches /api/auth/token
      // explicitly and the server mints service tokens directly. Avoids a DB read +
      // sign on every session check and shrinks the token-issuance surface.
      disableSettingJwtHeader: true,
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: CONVEX_JWT_AUDIENCE,
        expirationTime: USER_TOKEN_TTL,
        // Re-read org membership at every mint so orgId/role can't be elevated by
        // stale or client-controlled session metadata (codex review). NEVER set
        // `svc` here — that claim is reserved for the in-process service token.
        //
        // `session.activeOrganizationId` is set by the client-callable
        // `organization.setActive()` — never trust it alone (R-9.3): it is
        // re-validated here against a live Member row before being minted into
        // the claim. If it's unset or stale (e.g. the SSO-redirect race
        // OrgActivator exists to heal — see its docstring) fall back to the
        // user's SOLE membership, exactly like OrgActivator's own "1 membership
        // → activate it" rule; with 0 or 2+ memberships we don't guess and mint
        // orgId: null, same as an unresolved active org today.
        //
        // `organization: { archivedAt: null }` on both queries is the second of
        // three archived-org guards (#1075, A5 — the others are
        // resolveActiveOrganizationId and getApiKeyActorContext). This is the
        // one that matters most: it's the only chokepoint every Convex read/
        // write ultimately trusts, so an archived org's `orgId` never gets
        // minted into a claim at all — no per-query Convex-side check needed.
        definePayload: async ({ user, session }) => {
          const activeOrgId = (session as { activeOrganizationId?: string | null })
            .activeOrganizationId ?? null;

          if (activeOrgId) {
            const member = await prisma.member.findFirst({
              where: {
                organizationId: activeOrgId,
                userId: user.id,
                organization: { archivedAt: null },
              },
              select: { role: true },
            });
            if (member) {
              return { orgId: activeOrgId, role: member.role };
            }
          }

          const memberships = await prisma.member.findMany({
            where: { userId: user.id, organization: { archivedAt: null } },
            select: { organizationId: true, role: true },
            take: 2,
          });
          if (memberships.length === 1) {
            return { orgId: memberships[0].organizationId, role: memberships[0].role };
          }

          return { orgId: null, role: null };
        },
      },
    }),
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Enforce registration policy (siteSettings is Convex-only since Phase C)
          const settings = await getSiteSettingsFromConvex();
          const policy = settings.registrationPolicy;
          if (policy === "DISABLED" || policy === "INVITE_ONLY") {
            // Allow if this is the very first user (bootstrap)
            const count = await prisma.user.count();
            if (count > 0) {
              const email = (user as { email?: string }).email?.toLowerCase();

              // Allow if this user has a pending invitation
              const pendingInvite = await prisma.invitation.findFirst({
                where: {
                  email,
                  status: "pending",
                  expiresAt: { gte: new Date() },
                },
              });
              if (pendingInvite) return undefined;

              // Allow if user is being created via SSO (email domain matches an SSO provider)
              if (email) {
                const domain = email.split("@")[1];
                if (domain) {
                  const ssoProvider = await prisma.ssoProvider.findFirst({
                    where: { domain },
                  });
                  if (ssoProvider) return undefined;
                }
              }

              throw new Error(
                policy === "DISABLED"
                  ? "Registration is currently disabled."
                  : "Registration is invite-only. Contact an administrator.",
              );
            }
          }
          return undefined;
        },
        after: async (user) => {
          // Auto-promote first user to site admin
          const count = await prisma.user.count();
          if (count === 1) {
            await prisma.user.update({
              where: { id: user.id },
              data: { role: "admin" },
            });
          }

          // No auto-join (#1071, A1/A3): membership is only ever created by
          // invite-accept, request-approval, or org-create (creatorRole above).
          // A fresh signup with no invite and no org to bootstrap lands with
          // zero memberships and is routed to /welcome, the create-vs-join
          // fork (#1092, B1), same as a 0-org login.

          // Mirror the new user into Convex (best-effort; runs after the role
          // write above so the mirror captures the final role).
          await mirrorUserToConvex(user.id);
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          // When an SSO account is linked, mark ssoTestedSuccessfully for the org
          const providerId = (account as { providerId?: string }).providerId;
          if (!providerId?.startsWith("sso-")) return;
          try {
            const ssoProvider = await prisma.ssoProvider.findFirst({
              where: { providerId },
              select: { organizationId: true },
            });
            if (!ssoProvider?.organizationId) return;
            // SSO config lives in the Convex org-settings blob (source of truth).
            const settings = await readOrgSettingsBlob(ssoProvider.organizationId);
            if (settings.sso && !settings.sso.ssoTestedSuccessfully) {
              settings.sso.ssoTestedSuccessfully = true;
              await saveOrgSettings(ssoProvider.organizationId, settings);
            }
          } catch {
            // Non-critical — don't block login
          }
        },
      },
    },
  },
  trustedOrigins: [
    env.NEXT_PUBLIC_APP_URL,
    // SSO IdP origins — wildcards cover all subdomains/endpoints used in OIDC discovery
    "https://*.microsoftonline.com",
    "https://*.microsoft.com",
    "https://accounts.google.com",
    "https://*.googleapis.com",
    "https://*.okta.com",
    "https://*.auth0.com",
    "https://*.onelogin.com",
    "https://*.duosecurity.com",
    ...(env.SSO_TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
});
