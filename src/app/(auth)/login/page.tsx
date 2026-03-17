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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { name: platformName, icon: platformIcon } = usePlatformBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
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

  useEffect(() => {
    fetch("/api/auth/social-providers", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : { providers: [] })
      .then((d) => setSocialProviders(d.providers || []))
      .catch(() => setSocialProviders([]));
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

  const handleSocialLogin = async (provider: "google" | "microsoft") => {
    setSocialLoading(provider);
    try {
      await signIn.social({
        provider,
        callbackURL: "/dashboard",
      });
    } catch {
      toast.error("Something went wrong");
      setSocialLoading(null);
    }
  };

  const handlePasskeyLogin = async () => {
    setSocialLoading("passkey");
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        toast.error(result.error.message || "Passkey sign-in failed");
        setSocialLoading(null);
        return;
      }
      await handlePostLogin(router);
    } catch {
      toast.error("Passkey sign-in failed or was cancelled");
      setSocialLoading(null);
    }
  };

  const hasSocial = socialProviders.length > 0;

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
          {platformIcon ? (
            <DynamicIcon name={platformIcon} className="h-5 w-5" />
          ) : (
            platformName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
          )}
        </div>
        <CardTitle className="text-xl">
          {orgName ? `Sign in to ${orgName}` : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {orgName
            ? `Enter your credentials to access ${orgName}`
            : `Sign in to your ${platformName} account`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Email step — first step of the flow */}
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
            <Button type="submit" className="w-full" disabled={checkingSSO || !!socialLoading}>
              {checkingSSO && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Continue
            </Button>
          </form>
        )}

        {/* Password step — shown after email check finds no SSO */}
        {step === "password" && (
          <>
            <button
              type="button"
              onClick={() => setStep("email")}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
              <Button type="submit" className="w-full" disabled={loading || !!socialLoading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </form>
          </>
        )}

        {/* Social login + passkey */}
        <div className={hasSocial ? "relative" : "hidden"}>
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>
        <div className={hasSocial ? "grid gap-2" : "hidden"}>
          {socialProviders.includes("google") && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleSocialLogin("google")}
              disabled={!!socialLoading || loading || checkingSSO}
            >
              {socialLoading === "google" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon className="mr-2 h-4 w-4" />
              )}
              Continue with Google
            </Button>
          )}
          {socialProviders.includes("microsoft") && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleSocialLogin("microsoft")}
              disabled={!!socialLoading || loading || checkingSSO}
            >
              {socialLoading === "microsoft" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MicrosoftIcon className="mr-2 h-4 w-4" />
              )}
              Continue with Microsoft
            </Button>
          )}
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={handlePasskeyLogin}
          disabled={!!socialLoading || loading || checkingSSO}
        >
          {socialLoading === "passkey" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Fingerprint className="mr-2 h-4 w-4" />
          )}
          Sign in with Passkey
        </Button>
      </CardContent>
      {regOpen ? (
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
