"use client";
// use-client: interactive — session/org-creation-policy fetch + branch state (R-8.1.1)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { organization, signOut, useSession } from "@/lib/auth-client";
import { getMyOrganizations } from "@/server/public-org";
import { getOrgCreationPolicy } from "@/server/site-admin";
import { checkInviteCode, getJoinableOrgs, requestToJoinOrg, type JoinableOrg } from "@/server/org-join";
import { AuthShell } from "../auth-playful";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, Building2, Users2, ArrowLeft, KeyRound, Globe2, MailWarning } from "lucide-react";

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
    return <JoinView onBack={() => setView("fork")} />;
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
 * "Join my team" destination (#1067's B2, #1094) — two ways in. Possession of
 * an invite code is proof enough on its own (no verification needed); the
 * verified-domain "ask to join" branch requires `emailVerified` (anyone could
 * otherwise claim `@bigcorp.com` and request into a stranger's org).
 */
function JoinView({ onBack }: { onBack: () => void }) {
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
        <p className="mt-1 text-sm text-muted">Use an invite code, or ask to be let in.</p>
      </div>
      <div className="space-y-4">
        <InviteCodeEntry />
        <DomainJoinRequest />
      </div>
    </AuthShell>
  );
}

function InviteCodeEntry() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const handleSubmit = async () => {
    if (!value.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const found = await checkInviteCode(value);
      if (!found) {
        setError("We couldn't find that invite. Check the code or link and try again.");
        return;
      }
      router.push(`/invite/${found.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-[var(--r)] border-2 border-line-2 bg-card p-4">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink">
        <KeyRound className="h-3.5 w-3.5" />
        Have an invite?
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="Paste your invite link or code"
          className="min-w-0 flex-1 rounded-[8px] border-2 border-line-2 bg-elev px-3 py-1.5 text-sm text-ink outline-none focus:border-red"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={checking || !value.trim()}
          className="flex-none rounded-[8px] border-2 border-line-2 bg-elev px-3 py-1.5 text-sm font-bold text-ink transition-colors hover:border-red hover:text-red disabled:opacity-50"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red">{error}</p> : null}
    </div>
  );
}

function DomainJoinRequest() {
  const [state, setState] = useState<{ requiresVerification: boolean; orgs: JoinableOrg[] } | null>(null);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJoinableOrgs().then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRequest = async (orgId: string) => {
    setPendingId(orgId);
    try {
      await requestToJoinOrg(orgId);
      setRequestedIds((prev) => new Set(prev).add(orgId));
      toast.success("Request sent — you'll hear back once an admin reviews it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send that request.");
    } finally {
      setPendingId(null);
    }
  };

  if (state === null) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  if (state.requiresVerification) {
    return (
      <div className="flex items-start gap-2 rounded-[var(--r)] border-2 border-line-2 bg-elev p-4 text-sm text-ink-2">
        <MailWarning className="mt-0.5 h-4 w-4 flex-none text-muted" />
        <p>Verify your email to search for a team at your company&apos;s domain.</p>
      </div>
    );
  }

  if (state.orgs.length === 0) {
    return (
      <div className="rounded-[var(--r)] border-2 border-line-2 bg-elev p-4 text-sm text-ink-2">
        <p>We didn&apos;t find a team at your email domain. Ask your admin for an invite instead.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--r)] border-2 border-line-2 bg-card p-4">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink">
        <Globe2 className="h-3.5 w-3.5" />
        People at your company already use this
      </p>
      <div className="space-y-2">
        {state.orgs.map((org) => {
          const requested = requestedIds.has(org.organizationId) || org.alreadyRequested;
          return (
            <div
              key={org.organizationId}
              className="flex items-center justify-between gap-3 rounded-[8px] border-2 border-line-2 bg-elev px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{org.organizationName}</p>
                <p className="text-xs text-muted">
                  {org.memberCount} {org.memberCount === 1 ? "person" : "people"} already here
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRequest(org.organizationId)}
                disabled={requested || pendingId === org.organizationId}
                className="flex-none rounded-[8px] border-2 border-line-2 bg-card px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:border-red hover:text-red disabled:opacity-50"
              >
                {pendingId === org.organizationId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : requested ? (
                  "Request sent"
                ) : (
                  "Ask to join"
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
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
