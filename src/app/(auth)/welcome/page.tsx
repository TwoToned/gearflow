"use client";
// use-client: interactive — session/org-creation-policy fetch + branch state (R-8.1.1)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { organization, signOut, useSession } from "@/lib/auth-client";
import { getMyOrganizations } from "@/server/public-org";
import { getOrgCreationPolicy } from "@/server/site-admin";
import { AuthShell } from "../auth-playful";
import { cn } from "@/lib/utils";
import { Loader2, Building2, Users2, ArrowLeft } from "lucide-react";

/**
 * `/welcome` — B1 (#1092), the create-vs-join fork. Reached by a signed-in
 * user with zero live org memberships and no pending invite (invite signups
 * skip this entirely — register/page.tsx routes them straight to
 * /invite/[id]). `/no-organization` and every 0-org redirect in the app now
 * land here instead of the old dead-end `/onboarding` bounce.
 */
export default function WelcomePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [policy, setPolicy] = useState<{ allowed: boolean; codeRequired: boolean } | null>(null);
  const [view, setView] = useState<"fork" | "join">("fork");

  // A user who actually has a live org (arrived here via a stale bookmark, or
  // a second tab that just accepted an invite) never sees the fork — bounce
  // them to where they belong, same 0/1/2+ resolution as login/register.
  useEffect(() => {
    let cancelled = false;
    getMyOrganizations().then(async (orgs) => {
      if (cancelled) return;
      if (orgs.length === 1) {
        await organization.setActive({ organizationId: orgs[0].id });
        router.replace("/dashboard");
      } else if (orgs.length > 1) {
        router.replace("/select-organization");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    getOrgCreationPolicy().then((p) => {
      if (!cancelled) setPolicy(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNotYou = async () => {
    await signOut();
    router.push("/login");
  };

  if (view === "join") {
    return <JoinPlaceholder onBack={() => setView("fork")} />;
  }

  return (
    <ForkView
      session={session}
      policy={policy}
      onCreateCompany={() => router.push("/onboarding")}
      onJoinTeam={() => setView("join")}
      onNotYou={handleNotYou}
    />
  );
}

function ForkView({
  session,
  policy,
  onCreateCompany,
  onJoinTeam,
  onNotYou,
}: {
  session: ReturnType<typeof useSession>["data"];
  policy: { allowed: boolean; codeRequired: boolean } | null;
  onCreateCompany: () => void;
  onJoinTeam: () => void;
  onNotYou: () => void;
}) {
  return (
    <AuthShell accent="welcome" annotation="pick a lane — you can change it later.">
      <ForkHeader name={session?.user?.name} />

      <div className="space-y-3">
        {policy === null ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : (
          <>
            {policy.allowed && (
              <ForkCard
                primary
                icon={<Building2 className="h-[18px] w-[18px]" />}
                title="Set up a new company"
                desc="You run the gear. We'll walk you through tax, branding and numbering."
                onClick={onCreateCompany}
              />
            )}
            <ForkCard
              icon={<Users2 className="h-[18px] w-[18px]" />}
              title="Join my team"
              desc="Someone already set it up. Use an invite link, or ask to be let in."
              onClick={onJoinTeam}
            />
          </>
        )}
      </div>

      {session?.user?.email ? <SignedInAs email={session.user.email} onNotYou={onNotYou} /> : null}
    </AuthShell>
  );
}

function ForkHeader({ name }: { name: string | undefined }) {
  return (
    <div className="mb-6">
      {name ? <p className="t-annotation text-[15px] text-red">Welcome, {name.split(" ")[0]}</p> : null}
      <h1 className="t-title text-ink">What brings you here?</h1>
      <p className="mt-1 text-sm text-muted">You can change this later — nothing is locked in.</p>
    </div>
  );
}

function SignedInAs({ email, onNotYou }: { email: string; onNotYou: () => void }) {
  return (
    <p className="mt-6 text-center text-sm text-muted">
      Signed in as <span className="font-mono text-xs text-ink-2">{email}</span>
      {" · "}
      <button type="button" onClick={onNotYou} className="text-link hover:underline">
        Not you?
      </button>
    </p>
  );
}

/**
 * Placeholder destination for "Join my team" until #1067's B2 (invite-code
 * entry + verified-domain request-to-join) ships. Never strands the user —
 * just points them at the invite-link path that already works end to end.
 */
function JoinPlaceholder({ onBack }: { onBack: () => void }) {
  return (
    <AuthShell accent="join" annotation="ask nicely, tape's cheap.">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>
      <div className="mb-4">
        <h1 className="t-title text-ink">Join my team</h1>
        <p className="mt-1 text-sm text-muted">
          You&apos;ll need an invite from whoever runs your organisation.
        </p>
      </div>
      <div className="space-y-3 rounded-[var(--r)] border-2 border-line-2 bg-elev p-4 text-sm text-ink-2">
        <p>
          Ask them to send you an invite from{" "}
          <span className="font-medium text-ink">Settings → Team</span>. Open the link they
          send you and you&apos;ll land straight in — no need to come back here.
        </p>
        <p className="text-muted">
          Already have an invite link in your email? Open it directly instead of signing in
          here first.
        </p>
      </div>
    </AuthShell>
  );
}

function ForkCard({
  icon,
  title,
  desc,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-4 rounded-[var(--r)] border-2 bg-card p-4 text-left shadow-[var(--sh-card)] transition-all duration-200 hover:-translate-y-px hover:shadow-[var(--sh-hover)]",
        primary ? "border-red" : "border-line-2",
      )}
    >
      <span
        className={cn(
          "flex size-[38px] flex-none items-center justify-center rounded-[10px] border-2 shadow-[var(--sh-stk)]",
          primary ? "border-red text-red" : "border-line-2 text-muted",
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14.5px] font-bold text-ink">{title}</span>
        <span className="text-xs leading-relaxed text-muted">{desc}</span>
      </span>
      <span
        aria-hidden
        className={cn("mt-2 flex-none text-[15px]", primary ? "text-red" : "text-faint")}
      >
        →
      </span>
    </button>
  );
}
