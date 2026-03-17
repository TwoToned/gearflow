"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, organization, authClient } from "@/lib/auth-client";
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
import { Loader2 } from "lucide-react";
import { getIconComponent } from "@/lib/sso-icons";

interface OrgLoginInfo {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogo: string | null;
  hasSSO: boolean;
  ssoEnabled: boolean;
  enforceSSO: boolean;
  allowPasswordLogin: boolean;
  providers: Array<{
    providerId: string;
    issuer: string;
    domain: string;
    type: "saml" | "oidc";
    displayName: string;
    icon: string;
  }>;
}

async function fetchUserOrgs(): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch("/api/auth/organization/list", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return data ?? [];
}

async function handlePostLogin(router: ReturnType<typeof useRouter>, orgId: string) {
  const session = await authClient.getSession();
  const activeOrgId = session.data?.session?.activeOrganizationId;
  const orgs = await fetchUserOrgs();

  if (orgs.length === 0) {
    // User authenticated but not a member — might be pending approval
    router.push("/pending-approval");
    return;
  }

  // Set the specific org as active
  if (orgs.some((o) => o.id === orgId)) {
    if (activeOrgId !== orgId) {
      await organization.setActive({ organizationId: orgId });
    }
    router.push("/dashboard");
    return;
  }

  // Fallback: set first org
  if (activeOrgId && orgs.some((o) => o.id === activeOrgId)) {
    router.push("/dashboard");
    return;
  }

  await organization.setActive({ organizationId: orgs[0].id });
  router.push("/dashboard");
}

export function OrgLoginClient({
  orgInfo,
  initialEmail,
}: {
  orgInfo: OrgLoginInfo;
  initialEmail?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail || "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/auth/social-providers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((d) => setSocialProviders(d.providers || []))
      .catch(() => setSocialProviders([]));
  }, []);

  const handleSSO = async (providerId: string) => {
    setSsoLoading(true);
    try {
      await authClient.signIn.sso({
        providerId,
        callbackURL: "/dashboard",
        ...(email ? { loginHint: email } : {}),
      });
    } catch {
      toast.error("SSO sign-in failed. Please try again or contact your IT administrator.");
      setSsoLoading(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        toast.error(result.error.message || "Invalid credentials");
        return;
      }
      await handlePostLogin(router, orgInfo.orgId);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "microsoft") => {
    setLoading(true);
    try {
      await signIn.social({ provider, callbackURL: "/dashboard" });
    } catch {
      toast.error("Something went wrong");
      setLoading(false);
    }
  };

  const showSSOButton = orgInfo.hasSSO && orgInfo.ssoEnabled;
  const showPasswordForm = !orgInfo.enforceSSO && orgInfo.allowPasswordLogin;
  const showSocialButtons = !orgInfo.enforceSSO && socialProviders.length > 0;

  return (
    <Card>
      <CardHeader className="text-center">
        {orgInfo.orgLogo ? (
          <img
            src={orgInfo.orgLogo}
            alt={orgInfo.orgName}
            className="mx-auto mb-2 h-12 w-auto max-w-[200px] object-contain"
          />
        ) : (
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
            {orgInfo.orgName.charAt(0).toUpperCase()}
          </div>
        )}
        <CardTitle className="text-xl">{orgInfo.orgName}</CardTitle>
        <CardDescription>Sign in to continue</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* SSO Button — prominent at top */}
        {showSSOButton &&
          orgInfo.providers.map((provider) => {
            const ProviderIcon = getIconComponent(provider.icon);
            return (
              <Button
                key={provider.providerId}
                className="w-full h-14 text-base font-semibold"
                onClick={() => handleSSO(provider.providerId)}
                disabled={ssoLoading || loading}
              >
                {ssoLoading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <ProviderIcon className="mr-2 h-5 w-5" />
                )}
                Sign in with {provider.displayName}
              </Button>
            );
          })}

        {/* Divider — only if there are other options */}
        {showSSOButton && (showPasswordForm || showSocialButtons) && (
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Other sign-in options</span>
            </div>
          </div>
        )}

        {/* Social login buttons */}
        {showSocialButtons && (
          <div className="grid gap-2">
            {socialProviders.includes("google") && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleSocialLogin("google")}
                disabled={loading || ssoLoading}
              >
                Continue with Google
              </Button>
            )}
            {socialProviders.includes("microsoft") && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleSocialLogin("microsoft")}
                disabled={loading || ssoLoading}
              >
                Continue with Microsoft
              </Button>
            )}
          </div>
        )}

        {/* Email/password form */}
        {showPasswordForm && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={loading || ssoLoading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in with password
            </Button>
          </form>
        )}

        {/* Enforcement notice */}
        {orgInfo.enforceSSO && !orgInfo.hasSSO && (
          <p className="text-sm text-muted-foreground text-center">
            This organization requires SSO authentication, but no SSO provider is configured.
            Contact your administrator.
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Use a different account
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
