"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, organization, authClient } from "@/lib/auth-client";
import { getTheOrgId, getTheOrgInfo, getSingleOrgSSOInfo } from "@/server/public-org";
import { usePlatformBranding } from "@/lib/use-platform-name";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeIn } from "@/components/ui/motion";
import { toast } from "sonner";
import { Loader2, Fingerprint, ArrowLeft } from "lucide-react";

async function handlePostLogin(router: ReturnType<typeof useRouter>) {
  const orgData = await getTheOrgId();
  if (!orgData) {
    router.push("/onboarding");
    return;
  }
  await organization.setActive({ organizationId: orgData.id });
  router.push("/dashboard");
}

function DotGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.07]">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dot-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { name: platformName, icon: platformIcon } = usePlatformBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [step, setStep] = useState<"email" | "password">("email");
  const [checkingSSO, setCheckingSSO] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    getTheOrgInfo().then((info) => {
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
      // Single-org: check if the org has SSO configured for this email domain
      const ssoInfo = await getSingleOrgSSOInfo();
      if (ssoInfo && ssoInfo.ssoEnabled && ssoInfo.providers.length > 0) {
        const domain = email.split("@")[1]?.toLowerCase();
        const matchingProvider = ssoInfo.providers.find(
          (p: { domain: string }) => p.domain === domain
        );
        if (matchingProvider) {
          await authClient.signIn.sso({
            providerId: matchingProvider.providerId,
            callbackURL: "/dashboard",
            loginHint: email,
          });
          return;
        }
      }

      // No SSO match — show password form
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
      await handlePostLogin(router);
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
      await handlePostLogin(router);
    } catch {
      toast.error("Passkey sign-in failed or was cancelled");
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen bg-background">
      {/* Brand panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 bg-bg-inset items-center justify-center relative overflow-hidden">
        <DotGrid />
        <div className="relative z-10 max-w-md px-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">
              {platformIcon ? (
                <DynamicIcon name={platformIcon} className="h-5 w-5" />
              ) : (
                platformName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
              )}
            </div>
            <span className="text-2xl font-extrabold tracking-tight text-fg">
              {platformName}
            </span>
          </div>
          <p className="text-fg-3 text-[15px] leading-relaxed">
            Equipment management for production teams.
          </p>
        </div>

        {/* Subtle geometric accent — faint angled line */}
        <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full border border-fg/[0.04]" />
        <div className="absolute -top-16 -left-16 h-64 w-64 rounded-full border border-fg/[0.04]" />
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <FadeIn className="w-full max-w-sm">
          {/* Mobile-only brand header */}
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                {platformIcon ? (
                  <DynamicIcon name={platformIcon} className="h-4 w-4" />
                ) : (
                  platformName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
                )}
              </div>
              <span className="text-lg font-bold tracking-tight text-fg">
                {platformName}
              </span>
            </div>
          </div>

          <div className="mb-6">
            <h1 className="t-title text-fg">
              {orgName ? `Sign in to ${orgName}` : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-fg-3">
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
                  className="mb-4 flex items-center gap-1 text-sm text-fg-3 hover:text-fg transition-colors"
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

            {/* Passkey */}
            <Button
              variant="outline"
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
            <p className="mt-6 text-center text-sm text-fg-3">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          )}
        </FadeIn>
      </div>
    </div>
  );
}
