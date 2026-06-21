"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signUp, organization } from "@/lib/auth-client";
import { getTheOrgId } from "@/server/public-org";
import { usePlatformBranding } from "@/lib/use-platform-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldX } from "lucide-react";
import { AuthShell } from "../auth-playful";

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("invite");
  const { name: platformName } = usePlatformBranding();
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
      <div className="flex justify-center py-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted" />
      </div>
    );
  }

  if (policy === "DISABLED" && !inviteId) {
    return (
      <>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--r)] bg-out-soft text-t-out">
            <ShieldX className="h-5 w-5" />
          </div>
          <h2 className="t-title text-ink">Registration disabled</h2>
          <p className="mt-1 text-sm text-muted">
            New account registration is currently disabled. Contact an administrator for access.
          </p>
        </div>
        <div className="flex justify-center">
          <p className="text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-link hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </>
    );
  }

  if (policy === "INVITE_ONLY" && !inviteId) {
    return (
      <>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--r)] bg-elev text-muted">
            <ShieldX className="h-5 w-5" />
          </div>
          <h2 className="t-title text-ink">Invite only</h2>
          <p className="mt-1 text-sm text-muted">
            Registration is invite-only. Contact an administrator to get an invitation.
          </p>
        </div>
        <div className="flex justify-center">
          <p className="text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-link hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="t-title text-ink">Create your account</h2>
        <p className="mt-1 text-sm text-muted">
          Get started with {platformName} for your AV business
        </p>
      </div>
      <div>
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
              className={inviteEmailLocked ? "bg-elev" : ""}
            />
            {inviteEmailLocked && (
              <p className="text-xs text-muted">
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
      </div>
      <div className="mt-6 flex justify-center">
        <p className="text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-link hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}

export default function RegisterPage() {
  return (
    <AuthShell accent="join" annotation="first one's on the house.">
      <Suspense
        fallback={
          <div className="flex justify-center py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted" />
          </div>
        }
      >
        <RegisterContent />
      </Suspense>
    </AuthShell>
  );
}
