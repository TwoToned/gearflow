import { betterAuth } from "better-auth";
import { organization, twoFactor, admin } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "@/env";
import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { getPlatformName } from "./platform";
import { handleSSOProvisioning } from "./sso-provisioning";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
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
        subject: `Reset your ${pName} password`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>Click the button below to reset your password.</p>
            <p>
              <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
                Reset Password
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const pName = await getPlatformName();
      await sendEmail({
        to: user.email,
        subject: `Verify your ${pName} email`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Verify Your Email</h2>
            <p>Click the button below to verify your email address.</p>
            <p>
              <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
                Verify Email
              </a>
            </p>
          </div>
        `,
      });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      organizationLimit: 1,
      creatorRole: "owner",
      memberRoleHierarchy: ["owner", "admin", "manager", "member", "warehouse", "viewer"],
      sendInvitationEmail: async (data) => {
        const pName = await getPlatformName();
        const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${data.id}`;
        await sendEmail({
          to: data.email,
          subject: `You've been invited to ${data.organization.name} on ${pName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>You've been invited to join ${data.organization.name}</h2>
              <p>You've been invited to join <strong>${data.organization.name}</strong> as a <strong>${data.role}</strong> on ${pName}.</p>
              <p>
                <a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
                  Accept Invitation
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
            </div>
          `,
        });
      },
    }),
    twoFactor({
      issuer: "GearFlow",
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
  ],
  socialProviders: {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    }),
    ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && {
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
      },
    }),
  },
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
          // Enforce registration policy
          const settings = await prisma.siteSettings.findFirst();
          const policy = settings?.registrationPolicy ?? "OPEN";
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
              }
            }
          } catch {
            // Non-critical — don't block registration
          }
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
            const org = await prisma.organization.findUnique({
              where: { id: ssoProvider.organizationId },
            });
            if (!org) return;
            const settings = org.metadata ? JSON.parse(org.metadata) : {};
            if (settings.sso && !settings.sso.ssoTestedSuccessfully) {
              settings.sso.ssoTestedSuccessfully = true;
              await prisma.organization.update({
                where: { id: ssoProvider.organizationId },
                data: { metadata: JSON.stringify(settings) },
              });
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
