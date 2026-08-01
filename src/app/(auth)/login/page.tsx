"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn, organization, authClient } from "@/lib/auth-client";
import { getMyOrganizations, getSoloOrgBranding } from "@/server/public-org";
import { getOrgLoginInfo } from "@/server/sso";
import { usePlatformBranding } from "@/lib/use-platform-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Fingerprint, ArrowLeft } from "lucide-react";
import { AuthShell, HandNudge } from "../auth-playful";

/** `callbackUrl` comes from `src/middleware.ts`'s login redirect (or a manual
 *  deep link like the invite flow) — only ever trust it as a SAME-ORIGIN
 *  relative path ("/foo", never "//evil.com" or an absolute URL), so this can
 *  never become an open redirect. Anything else falls back to "/dashboard". */
function safeCallbackUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

async function handlePostLogin(router: ReturnType<typeof useRouter>, callbackUrl: string | null) {
  const orgs = await getMyOrganizations();
  if (orgs.length === 0) {
    router.push("/onboarding");
    return;
  }
  if (orgs.length === 1) {
    await organization.setActive({ organizationId: orgs[0].id });
    router.push(callbackUrl ?? "/dashboard");
    return;
  }
  // 2+ memberships: never guess which one — route to the picker (#1071, A1).
  const target = callbackUrl ?? "/dashboard";
  router.push(`/select-organization?callbackUrl=${encodeURIComponent(target)}`);
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const { name: platformName } = usePlatformBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [step, setStep] = useState<"email" | "password">("email");
  const [checkingSSO, setCheckingSSO] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    getSoloOrgBranding().then((info) => {
      if (info) setOrgName(info.name);
    });
  }, []);

  useEffect(() => {
    fetch("/api/registration-policy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRegOpen(d.policy === "OPEN"))
      .catch(() => setRegOpen(false));
  }, []);

  const handleEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setCheckingSSO(true);
    try {
      // Resolve which org(s) have SSO configured for this email domain
      // (#1071, A1 — the login page can no longer assume "the org"). Ambiguous
      // across orgs (2+ matches) falls through to password login rather than
      // guess which org's SSO to trigger.
      const domain = email.split("@")[1]?.toLowerCase();
      const lookupRes = await fetch("/api/auth/sso/org-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const lookup = lookupRes.ok
        ? ((await lookupRes.json()) as { orgs: { orgSlug: string; hasSSO: boolean }[] })
        : { orgs: [] };
      const ssoOrgs = lookup.orgs.filter((o) => o.hasSSO);

      if (ssoOrgs.length === 1) {
        const ssoInfo = await getOrgLoginInfo(ssoOrgs[0].orgSlug);
        const matchingProvider = ssoInfo?.providers.find((p) => p.domain === domain);
        if (ssoInfo?.ssoEnabled && matchingProvider) {
          await authClient.signIn.sso({
            providerId: matchingProvider.providerId,
            callbackURL: callbackUrl ?? "/dashboard",
            loginHint: email,
          });
          return;
        }
      }

      // No SSO match (or ambiguous across orgs) — show password form
      setStep("password");
    } catch {
      setStep("password");
    } finally {
      setCheckingSSO(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        toast.error(result.error.message || "Invalid credentials");
        return;
      }
      await handlePostLogin(router, callbackUrl);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        toast.error(result.error.message || "Passkey sign-in failed");
        setPasskeyLoading(false);
        return;
      }
      await handlePostLogin(router, callbackUrl);
    } catch {
      toast.error("Passkey sign-in failed or was cancelled");
      setPasskeyLoading(false);
    }
  };

  return (
    <AuthShell accent="welcome" annotation="venue's dark, the app isn't.">
      <div className="mb-6">
        <h1 className="t-title text-ink">
          {orgName ? `Sign in to ${orgName}` : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {orgName
            ? `Enter your credentials to access ${orgName}`
            : `Sign in to your ${platformName} account`}
        </p>
      </div>

      <div className="space-y-4">
        {/* Email step */}
        {step === "email" && (
          <form onSubmit={handleEmailContinue} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="username webauthn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={checkingSSO || passkeyLoading}>
              {checkingSSO && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Continue
            </Button>
          </form>
        )}

        {/* Password step */}
        {step === "password" && (
          <div className="animate-in fade-in slide-in-from-right-2 duration-200">
            <button
              type="button"
              onClick={() => setStep("email")}
              className="mb-4 flex items-center gap-1 text-sm text-muted hover:text-ink transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-pw">Email</Label>
                <Input
                  id="email-pw"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || passkeyLoading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </form>
          </div>
        )}

        {/* Passkey — with a cheeky hand-drawn nudge */}
        <div className="flex items-center justify-end pr-1">
          <HandNudge>quickest way in</HandNudge>
        </div>
        <Button
          variant="line"
          className="w-full"
          onClick={handlePasskeyLogin}
          disabled={passkeyLoading || loading || checkingSSO}
        >
          {passkeyLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Fingerprint className="mr-2 h-4 w-4" />
          )}
          Sign in with Passkey
        </Button>
      </div>

      {regOpen && (
        <p className="mt-6 text-center text-sm text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-link hover:underline">
            Sign up
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
