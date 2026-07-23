/**
 * Whether Better Auth should mark session cookies Secure — gated on the app's
 * serve protocol (NEXT_PUBLIC_APP_URL), not the OAuth/JWT issuer. Local dev
 * serves http, so marking cookies Secure there would make the browser drop
 * them; prod serves https, so cookies stay hardened. POLICY.md R-8.4.5.
 */
export function shouldUseSecureCookies(appUrl: string): boolean {
  return appUrl.startsWith("https://");
}
