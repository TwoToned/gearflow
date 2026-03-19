"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient, organization } from "@/lib/auth-client";
import { getTheOrgId } from "@/server/public-org";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    authClient.getSession().then((session) => {
      setIsAuthenticated(!!session.data?.user);
    });
  }, []);

  const handleAccept = async () => {
    setLoading(true);
    try {
      const res = await organization.acceptInvitation({
        invitationId: id,
      });
      if (res.error) {
        setError(res.error.message || "Failed to accept invitation");
        return;
      }
      setAccepted(true);
      toast.success("Invitation accepted!");
      // Set the single org as active and redirect
      const orgData = await getTheOrgId();
      if (orgData) {
        await organization.setActive({ organizationId: orgData.id });
      }
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated === null) {
    return (
      <FadeIn>
      <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-fg-3" />
      </div>
      </FadeIn>
    );
  }

  if (accepted) {
    return (
      <FadeIn>
      <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center space-y-4">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
        <div>
          <h2 className="text-lg font-semibold">Invitation Accepted</h2>
          <p className="text-sm text-fg-3">
            Redirecting to the dashboard...
          </p>
        </div>
      </div>
      </FadeIn>
    );
  }

  if (error) {
    return (
      <FadeIn>
      <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center space-y-4">
        <XCircle className="mx-auto h-12 w-12 text-destructive" />
        <div>
          <h2 className="text-lg font-semibold">Cannot Accept Invitation</h2>
          <p className="text-sm text-fg-3">{error}</p>
        </div>
        <Button variant="outline" onClick={() => router.push("/login")}>
          Go to Login
        </Button>
      </div>
      </FadeIn>
    );
  }

  if (!isAuthenticated) {
    return (
      <FadeIn>
      <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            GF
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Organization Invitation</h2>
          <p className="text-sm text-fg-3">
            You need to sign in or create an account to accept this invitation.
          </p>
        </div>
        <div className="space-y-3">
          <Button
            className="w-full"
            onClick={() => router.push(`/login?callbackUrl=/invite/${id}`)}
          >
            Sign in
          </Button>
          <Button
            variant="outline"
            className="w-full"
            render={<Link href={`/register?invite=${id}`} />}
          >
            Create an account
          </Button>
        </div>
      </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
          GF
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Organization Invitation</h2>
        <p className="text-sm text-fg-3">
          You&apos;ve been invited to join an organization.
        </p>
      </div>
      <div className="space-y-4">
        <Button
          className="w-full"
          onClick={handleAccept}
          disabled={loading}
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Accept Invitation
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => router.push("/dashboard")}
        >
          Go to Dashboard
        </Button>
      </div>
    </div>
    </FadeIn>
  );
}
