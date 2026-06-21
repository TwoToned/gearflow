import { useRef } from "react";
import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient, adminClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  // In the browser, always talk to the origin that actually served the page.
  // The /api/auth handler is co-located with the app, so this is same-origin by
  // definition — no CORS, and moving domains never requires a rebuild. We
  // deliberately do NOT use NEXT_PUBLIC_APP_URL here: it's inlined into the JS
  // bundle at build time, so a baked value would keep pointing at the old domain
  // after a move (this caused a CORS failure when the app moved to flow.rvlt.app).
  // Only SSR (no window) falls back to the env value.
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
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
