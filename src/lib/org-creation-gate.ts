import crypto from "crypto";
import { getConvexClient, withConvexReadRetry } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Phase B (#1067), B3 (#1095, D6) — the org-creation gate: a site-admin
 * toggle (`allowOrgCreation`, already wired through `getSiteSettingsFromConvex`/
 * `updateSiteSettings`) plus an optional signup code.
 *
 * ⚠️ The code itself is a SECRET, deliberately kept out of
 * `src/lib/site-settings-read.ts`'s `SiteSettingsRow`/`mapDoc()` — that
 * function feeds `/api/registration-policy`-style public routes and
 * `usePlatformBranding()`. A field that reaches `mapDoc()` reaches every
 * browser on the instance (design doc §5.3 pt.2). This module is the ONLY
 * place the raw code is read, and every caller is either the requireSiteAdmin()
 * settings page or the org-creation gate check below — never a public route.
 */

export interface OrgCreationGateSettings {
  allowOrgCreation: boolean;
  codeEnabled: boolean;
  code: string | null;
}

/** Site-admin/gate-check-only read of the org-creation gate's full state,
 *  including the raw signup code. `getSingleton` is `requireService`-gated
 *  (see convex/siteSettings.ts) — never browser-reachable directly. */
export async function getOrgCreationGateSettings(): Promise<OrgCreationGateSettings> {
  const doc = await withConvexReadRetry(async () =>
    (await getConvexClient()).query(api.siteSettings.getSingleton, {}),
  );
  return {
    allowOrgCreation: doc?.allowOrgCreation ?? true,
    codeEnabled: doc?.orgCreationCodeEnabled ?? false,
    code: doc?.orgCreationCode ?? null,
  };
}

/** A fresh signup code — same shape as `generateSecret()` in
 *  `src/server/woocommerce.ts` (hex, no ambiguous characters to worry about
 *  since it's never hand-typed the way a paper form field would be). */
export function generateOrgCreationCode(): string {
  return crypto.randomBytes(12).toString("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Buffers of different length can't be compared by timingSafeEqual — but
  // returning early on length is itself only a length oracle, not a content
  // oracle, and the codes are fixed-length (see generateOrgCreationCode), so
  // this never leaks anything about a real code's content.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a submitted signup code against the stored one. Server is the sole
 * authority (R-9.3) — the client never receives the code to compare against,
 * and every caller must pass a `rateLimitKey` derived from a VERIFIED identity
 * (e.g. the authenticated user's id), never a client-supplied value.
 *
 * Scope note: rate limiting here is per-`rateLimitKey` only (see
 * `checkOrgCreationRateLimit`, convex/siteSettings.ts). The design doc asks
 * for per-session AND per-IP limiting; Better Auth's `beforeCreateOrganization`/
 * `allowUserToCreateOrganization` hooks (src/lib/auth.ts, where this is called
 * from) receive only `{ organization, user }` — no request/IP — in this
 * better-auth version (1.6.25), so per-IP limiting isn't available at this
 * call site. Per-user limiting plus the fact that creating an org already
 * requires an authenticated account (registration is itself gated) is the
 * mitigating factor; a future pre-flight HTTP endpoint (once Phase B's B1
 * fork screen exists) would have request access and could add per-IP limiting
 * on top of this if abuse is ever observed.
 */
export async function verifyOrgCreationCode(
  submittedCode: string | null | undefined,
  rateLimitKey: string,
): Promise<boolean> {
  const settings = await getOrgCreationGateSettings();
  if (!settings.allowOrgCreation) return false;
  if (!settings.codeEnabled) return true;
  if (!settings.code) return false;

  try {
    await (await getConvexClient()).mutation(api.siteSettings.checkOrgCreationRateLimit, {
      key: rateLimitKey,
    });
  } catch {
    return false; // rate limited — treated the same as an invalid code
  }

  if (!submittedCode) return false;
  return constantTimeEqual(submittedCode, settings.code);
}
