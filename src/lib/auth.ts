import { betterAuth } from "better-auth";
import { organization, twoFactor, admin, jwt } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "@/env";
import { prisma } from "@/lib/prisma";
import { mirrorUserToConvex } from "@/lib/user-mirror";
import { upsertMemberMirrorByOrgUser } from "@/lib/member-mirror";
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
import { getTheOrg } from "./single-org";
import { CONVEX_JWT_AUDIENCE, USER_TOKEN_TTL } from "./convex-auth-constants";

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
    useSecureCookies: env.NEXT_PUBLIC_APP_URL.startsWith("https://"),
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
      // Single-org app (organizationLimit below): self-serve org creation is
      // only for the one-time bootstrap (src/app/(auth)/onboarding/page.tsx),
      // never for adding a second org once one exists — otherwise no user
      // could ever get past onboarding on a fresh deployment (R-8.4 auth).
      allowUserToCreateOrganization: async () => !(await getTheOrg()),
      organizationLimit: 1,
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
        keyPairConfig: { alg: "ES256" },
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
        // stale or client-controlled session metadata (codex review). Single-org
        // app: the one org + this user's member row. NEVER set `svc` here — that
        // claim is reserved for the in-process service token.
        definePayload: async ({ user }) => {
          const org = await getTheOrg();
          const orgId = org?.id ?? null;
          let role: string | null = null;
          if (orgId) {
            const member = await prisma.member.findFirst({
              where: { organizationId: orgId, userId: user.id },
              select: { role: true },
            });
            role = member?.role ?? null;
          }
          return { orgId, role };
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

          // Single-org: auto-add new users as members of the org
          try {
            const org = await prisma.organization.findFirst({
              select: { id: true },
              orderBy: { createdAt: "asc" },
            });
            if (org) {
              const existing = await prisma.member.findFirst({
                where: { organizationId: org.id, userId: user.id },
              });
              if (!existing) {
                // First user (owner) gets owner role, others get member
                const hasOwner = await prisma.member.findFirst({
                  where: { organizationId: org.id, role: "owner" },
                });
                await prisma.member.create({
                  data: {
                    organizationId: org.id,
                    userId: user.id,
                    role: hasOwner ? "member" : "owner",
                  },
                });
                // Additive (auto-create on registration): mirror best-effort.
                await upsertMemberMirrorByOrgUser(org.id, user.id);
              }
            }
          } catch {
            // Non-critical — don't block registration
          }

          // Mirror the new user into Convex (best-effort; runs after the role +
          // org-membership writes above so the mirror captures the final role).
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
