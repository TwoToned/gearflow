"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { organization } from "@/lib/auth-client";
import { getMyOrganizations, mirrorMyMembership, seedOrgDefaults, checkSlugAvailable } from "@/server/public-org";
import { getOrgCreationPolicy } from "@/server/site-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WizardRail } from "@/components/ui/wizard-rail";
import { AuthShell } from "../auth-playful";
import { StepOperating } from "./step-operating";
import { StepBranding } from "./step-branding";
import { StepNumbering } from "./step-numbering";
import { StepTeamGear } from "./step-team-gear";
import { TOTAL_STEPS } from "./wizard-steps";
import { capture, AnalyticsEvent, type SetupStepId } from "@/lib/analytics";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Loader2, Check, X } from "lucide-react";

const SLUG_CHECK_DEBOUNCE_MS = 400;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type SlugCheckStatus = "checking" | "available" | "taken";
type SlugStatus = "idle" | SlugCheckStatus;

/** D4 (#1108) — the wizard-wide step-outcome tally `setup_completed` reports
 *  once the final step finishes. A plain mutable object (not React state):
 *  nothing here needs to trigger a re-render, it's read exactly once, at the
 *  very end. */
export interface SetupStepTally {
  completed: number;
  skipped: number;
}

/** Steps 2+ each need a real org to write against — split out of
 *  `SetupPage`'s own body purely to keep that component's cyclomatic
 *  complexity under the R-3.6/complexity-ratchet ceiling (each `if` adds a
 *  decision point, and a 4th step pushed the inline version over it). Null
 *  when still on step 1 (the name form renders instead) or `createdOrgId`
 *  isn't set yet. `onStepOutcome`/`onFinalStepOutcome` are D4's per-step
 *  tally callbacks, threaded into each later step alongside its existing
 *  `onDone` — purely additive, doesn't change `onDone`'s own behavior. Both
 *  are plain functions (not the ref they close over) so this render
 *  function never touches ref state itself (react-hooks/refs) — only
 *  `SetupPage`'s own event-handler-time closures do. */
function renderLaterStep(
  step: number,
  createdOrgId: string | null,
  setStep: (n: number) => void,
  router: ReturnType<typeof useRouter>,
  onStepOutcome: (outcome: "completed" | "skipped") => void,
  onFinalStepOutcome: (outcome: "completed" | "skipped") => void,
): ReactNode {
  if (!createdOrgId) return null;
  if (step === 2) return <StepOperating orgId={createdOrgId} onDone={() => setStep(3)} onStepOutcome={onStepOutcome} />;
  if (step === 3) return <StepBranding orgId={createdOrgId} onDone={() => setStep(4)} onStepOutcome={onStepOutcome} />;
  if (step === 4) return <StepNumbering orgId={createdOrgId} onDone={() => setStep(5)} onStepOutcome={onStepOutcome} />;
  if (step === 5) {
    return <StepTeamGear orgId={createdOrgId} onDone={() => router.push("/today")} onStepOutcome={onFinalStepOutcome} />;
  }
  return null;
}

/**
 * `/setup` — the wizard shell, hosting all 5 steps as client-side state on
 * one route (not one route per step — `WizardRail`'s generic `step`/`total`
 * props and this page's own `TOTAL_STEPS` constant are shared across every
 * step for exactly this reason). Reached only from `/welcome`'s "Set up a
 * new company" card (B1, #1092).
 *
 * Step 0/1 (C1, #1098) is the ONLY blocking screen (D3): naming the org
 * commits it for real — `organization.create()` → `setActive()` →
 * `mirrorMyMembership()`. Every later screen (step 2, C2/#1099; step 3, C3/
 * #1101; step 4, C4/#1102; step 5, C5/#1103) is then an ordinary write
 * against a live org rather than draft state, and can be skipped. C6
 * (#1104) is the dashboard "Finish setup" checklist, not another wizard
 * step.
 */
export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeRequired, setCodeRequired] = useState(false);
  const [slugCheckStatus, setSlugCheckStatus] = useState<SlugCheckStatus>("checking");
  const slugCheckId = useRef(0);
  // D4 (#1108) — step 1 is never skippable, so it always counts toward
  // "completed" the moment the org is created (below).
  const stepTally = useRef<SetupStepTally>({ completed: 0, skipped: 0 });

  useEffect(() => {
    capture(AnalyticsEvent.SetupStepViewed, { step: "company" satisfies SetupStepId });
  }, []);

  // Redirect away if the user already belongs to an org. Guard on a cancelled
  // flag: if the user navigates away before this async check resolves, the
  // late resolve must not fire router.replace and snap them back to /dashboard.
  useEffect(() => {
    let cancelled = false;
    getMyOrganizations().then((orgs) => {
      if (!cancelled && orgs.length > 0) router.replace("/today");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // This form is the "Set up a new company" branch of /welcome (#1092, B1) —
  // if a site admin has switched org creation off since the fork screen was
  // rendered (or someone bookmarked this URL directly), bounce back rather
  // than show a form the server will refuse anyway (R-9.3: hiding it here is
  // cosmetic, `beforeCreateOrganization` is the real gate either way).
  useEffect(() => {
    let cancelled = false;
    getOrgCreationPolicy().then((policy) => {
      if (cancelled) return;
      if (!policy.allowed) {
        router.replace("/welcome");
        return;
      }
      setCodeRequired(policy.codeRequired);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Debounced, server-side slug-availability tick — UX only. The unique
  // constraint on Organization.slug (enforced at submit, via
  // organization.create()) is the real gate: "the tick is not a promise
  // until submit." An empty slug needs no network round trip, so that case
  // is a plain render-time derivation (`slugStatus` below) rather than state
  // pushed from this effect.
  useEffect(() => {
    const normalized = slug.trim();
    if (!normalized) return;
    setSlugCheckStatus("checking"); // eslint-disable-line react-hooks/set-state-in-effect
    const id = ++slugCheckId.current;
    const timer = setTimeout(() => {
      checkSlugAvailable(normalized).then((available) => {
        if (slugCheckId.current !== id) return; // superseded by a newer keystroke
        setSlugCheckStatus(available ? "available" : "taken");
      });
    }, SLUG_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [slug]);

  const slugStatus: SlugStatus = slug.trim() ? slugCheckStatus : "idle";

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(slugify(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || (codeRequired && !code.trim())) return;
    setLoading(true);
    try {
      const result = await organization.create({
        name: name.trim(),
        slug: slug.trim(),
        // Verified server-side in beforeCreateOrganization (src/lib/auth.ts) —
        // stripped from the persisted org row either way (it's a one-time
        // proof of authorization, not org data).
        ...(codeRequired ? { metadata: { orgCreationCode: code.trim() } } : {}),
      });
      if (result.error) {
        toast.error(result.error.message || "Failed to create organization");
      } else {
        // Set as active organization
        await organization.setActive({
          organizationId: result.data!.id,
        });
        // The org (+ membership, now active) already exists in Postgres past
        // this point, so a transient failure in either of the two calls below
        // must never surface as a blanket "Something went wrong" — that would
        // strand the user on a form whose own retry now fails with "slug
        // already taken" against an org they in fact already own, with no way
        // back. Both are genuinely best-effort (their own docstrings in
        // public-org.ts say so): log and move on to the success redirect
        // regardless. mirrorMyMembership's own mirror write already swallows
        // failures internally (member-mirror.ts's non-strict runMirror), so
        // this mainly guards seedOrgDefaults' direct Convex mutation.
        try {
          // The org plugin's own create path never mirrors the new owner's
          // membership into Convex (only src/server/site-admin.ts's
          // admin-driven path does) — without this, every Convex-authorized
          // action afterward fails with "not a member of this organization".
          await mirrorMyMembership(result.data!.id);
          // Seed the new org's tax rate + currency from the platform's
          // current defaults (#1077, A7; C1, #1098) — copied once, at
          // creation, and busts the login-info cache for this slug.
          await seedOrgDefaults(result.data!.id, slug.trim());
        } catch (postCreateError) {
          logger.error("setup: post-creation seed/mirror step failed (best-effort)", {
            organizationId: result.data!.id,
            error: postCreateError,
          });
        }
        toast.success("Company created!");
        stepTally.current.completed++;
        capture(AnalyticsEvent.SetupStepCompleted, { step: "company" satisfies SetupStepId });
        setCreatedOrgId(result.data!.id);
        setStep(2);
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // D4 (#1108) — built here (not inside renderLaterStep) so no ref crosses
  // into that render-time function call; both close over `stepTally` but
  // only ever run later, from a Skip/Save/Finish click.
  const onStepOutcome = (outcome: "completed" | "skipped") => {
    if (outcome === "completed") stepTally.current.completed++;
    else stepTally.current.skipped++;
  };
  const onFinalStepOutcome = (outcome: "completed" | "skipped") => {
    onStepOutcome(outcome);
    // The wizard is done the moment step 5 resolves, whichever button got
    // it there — report the full-session tally now, including step 5's own
    // just-recorded outcome.
    capture(AnalyticsEvent.SetupCompleted, {
      steps_completed: stepTally.current.completed,
      steps_skipped: stepTally.current.skipped,
    });
  };
  // react-hooks/refs flags these two callbacks for CLOSING OVER stepTally,
  // even though renderLaterStep only ever hands them to a child as an
  // onDone/onStepOutcome prop — invoked later, from that child's own Skip/
  // Save click, never synchronously here during render. Same accepted
  // pattern as src/lib/auth-client.ts's useActiveOrganization.
  // eslint-disable-next-line react-hooks/refs
  const laterStep = renderLaterStep(step, createdOrgId, setStep, router, onStepOutcome, onFinalStepOutcome);
  if (laterStep) return laterStep;

  return (
    <AuthShell accent="setup" annotation="first the name — the rest can wait.">
      <WizardRail step={1} total={TOTAL_STEPS} />
      <p className="t-annotation text-[13px] text-red">Step 1 of {TOTAL_STEPS} · Your company</p>
      <h1 className="t-title mt-1 text-ink">What&apos;s the company called?</h1>
      <p className="mt-1 text-sm text-muted">This goes on every quote, docket and invoice you send.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="org-name">Company name</Label>
          <Input
            id="org-name"
            type="text"
            placeholder="Acme Productions"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-slug">Organization slug</Label>
          <div className="relative">
            <Input
              id="org-slug"
              type="text"
              placeholder="acme-productions"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className="pr-24"
            />
            <SlugStatusBadge status={slugStatus} />
          </div>
          <p className="text-xs text-fg-3">
            Used internally. Only lowercase letters, numbers, and hyphens.
          </p>
        </div>
        {codeRequired && (
          <div className="space-y-2">
            <Label htmlFor="org-creation-code">Signup code</Label>
            <Input
              id="org-creation-code"
              type="text"
              placeholder="Ask your admin for this"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-xs text-muted">Everything after this is skippable.</span>
          <Button type="submit" disabled={loading || slugStatus === "taken"}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create company
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

function SlugStatusBadge({ status }: { status: SlugStatus }) {
  if (status === "idle") return null;
  return (
    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs">
      {status === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
      {status === "available" && (
        <span className="inline-flex items-center gap-1 font-medium text-ok">
          <Check className="h-3.5 w-3.5" /> Available
        </span>
      )}
      {status === "taken" && (
        <span className="inline-flex items-center gap-1 font-medium text-red">
          <X className="h-3.5 w-3.5" /> Taken
        </span>
      )}
    </span>
  );
}
