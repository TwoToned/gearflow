import { useRef } from "react";
import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient, adminClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [
    organizationClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.href = "/two-factor";
      },
    }),
    adminClient(),
    passkeyClient(),
    ssoClient(),
  ],
});

export const signIn = authClient.signIn;
export const signUp = authClient.signUp;
export const signOut = authClient.signOut;
export const useSession = authClient.useSession;
export const organization = authClient.organization;
export const useListOrganizations = authClient.useListOrganizations;

/**
 * Wrapper around Better Auth's useActiveOrganization that returns a stable
 * orgId. Once the org resolves, the previous value is held during re-fetches
 * to prevent query key flicker (undefined → id) that causes DOM errors.
 */
export function useActiveOrganization() {
  const result = authClient.useActiveOrganization();
  const lastOrgId = useRef<string | undefined>(undefined);

  const currentId = result.data?.id;
  if (currentId !== undefined) {
    lastOrgId.current = currentId; // eslint-disable-line react-hooks/refs
  }

  return {
    ...result,
    // eslint-disable-next-line react-hooks/refs
    data: result.data ?? (lastOrgId.current ? { id: lastOrgId.current } as unknown as typeof result.data : undefined),
  };
}
