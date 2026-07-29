import { ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadAuthorizeContext, approveOauthAuthorization, denyOauthAuthorization } from "@/server/oauth-authorize";

export const metadata = { title: "Authorize access — RVLT Flow" };

/**
 * `/oauth/authorize` — the MCP OAuth 2.1 consent screen (Phase 7, #1003).
 * A plain Next.js Server Component: `src/middleware.ts` already gates this
 * path on a Better Auth session cookie (it's not in the public/bearer-exempt
 * lists), redirecting to `/login?callbackUrl=...` first if the visitor isn't
 * signed in — the "gated on an existing Better Auth session" requirement is
 * enforced there, not here.
 *
 * Deliberately NOT styled like the marketing `AuthShell` login/register
 * pages — a consent screen for account access should read as sober and
 * trustworthy, not playful.
 */
export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const result = await loadAuthorizeContext(params);

  if (!result.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-md rounded-lg bg-bg-surface p-8 text-center surface-ring">
          <XCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />
          <h1 className="t-title text-ink">Can&apos;t authorize this request</h1>
          <p className="mt-2 t-body text-muted">{result.message}</p>
        </div>
      </div>
    );
  }

  const { client, scopeDescriptions, query } = result.data;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-lg bg-bg-surface p-8 surface-ring">
        <ShieldCheck className="mb-4 h-10 w-10 text-red" />
        <h1 className="t-title text-ink">
          <span className="font-semibold">{client.name}</span> wants to connect
        </h1>
        <p className="mt-2 t-body text-fg-3">
          This will let it act on your behalf in RVLT Flow, bounded by your own role. You can revoke
          this at any time from Settings → API keys.
        </p>

        <ScopeList scopeDescriptions={scopeDescriptions} />

        <form className="mt-6 flex gap-3">
          <input type="hidden" name="client_id" value={query.client_id} />
          <input type="hidden" name="redirect_uri" value={query.redirect_uri} />
          <input type="hidden" name="scope" value={query.scope} />
          <input type="hidden" name="code_challenge" value={query.code_challenge} />
          {query.state !== undefined && <input type="hidden" name="state" value={query.state} />}
          {query.resource !== undefined && <input type="hidden" name="resource" value={query.resource} />}

          <Button type="submit" formAction={denyOauthAuthorization} variant="line" className="flex-1">
            Deny
          </Button>
          <Button type="submit" formAction={approveOauthAuthorization} className="flex-1">
            Allow
          </Button>
        </form>
      </div>
    </div>
  );
}

function ScopeList({ scopeDescriptions }: { scopeDescriptions: string[] }) {
  if (scopeDescriptions.length === 0) {
    return (
      <p className="mt-6 t-body text-fg-3">
        No scopes are granted — your current role doesn&apos;t permit any of the requested access.
      </p>
    );
  }
  return (
    <div className="mt-6">
      <p className="t-annotation text-fg-3">This will be able to:</p>
      <ul className="mt-2 space-y-1.5">
        {scopeDescriptions.map((desc) => (
          <li key={desc} className="flex items-start gap-2 t-body text-ink">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
            {desc}
          </li>
        ))}
      </ul>
    </div>
  );
}
