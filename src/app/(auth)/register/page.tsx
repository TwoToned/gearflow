"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signUp, organization } from "@/lib/auth-client";
import { getTheOrgId } from "@/server/public-org";
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
import { Loader2, ShieldX } from "lucide-react";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("invite");
  const { name: platformName, icon: platformIcon } = usePlatformBranding();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [policy, setPolicy] = useState<string | null>(null);
  const [inviteEmailLocked, setInviteEmailLocked] = useState(false);

  useEffect(() => {
    fetch("/api/registration-policy", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPolicy(d.policy))
      .catch(() => setPolicy("OPEN"));
  }, []);

  // Prefill email from invitation
  useEffect(() => {
    if (inviteId) {
      import("@/server/invitations").then(({ getInvitationEmail }) => {
        getInvitationEmail(inviteId).then((invEmail) => {
          if (invEmail) {
            setEmail(invEmail);
            setInviteEmailLocked(true);
          }
        });
      });
    }
  }, [inviteId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        toast.error(result.error.message || "Registration failed");
      } else {
        if (inviteId) {
          router.push(`/invite/${inviteId}`);
        } else {
          // Activate the single org (auto-member hook added them during signup)
          const orgData = await getTheOrgId();
          if (orgData) {
            await organization.setActive({ organizationId: orgData.id });
          }
          router.push("/dashboard");
        }
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (policy === null) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (policy === "DISABLED" && !inviteId) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-destructive text-destructive-foreground">
            <ShieldX className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Registration Disabled</CardTitle>
          <CardDescription>
            New account registration is currently disabled. Contact an administrator for access.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    );
  }

  if (policy === "INVITE_ONLY" && !inviteId) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ShieldX className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">Invite Only</CardTitle>
          <CardDescription>
            Registration is invite-only. Contact an administrator to get an invitation.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    );
  }

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
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          Get started with {platformName} for your AV business
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={inviteEmailLocked}
              className={inviteEmailLocked ? "bg-muted" : ""}
            />
            {inviteEmailLocked && (
              <p className="text-xs text-muted-foreground">
                Email is set from your invitation and cannot be changed.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min. 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create account
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    }>
      <RegisterContent />
    </Suspense>
  );
}
