"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { organization } from "@/lib/auth-client";
import { getMyOrganizations, mirrorMyMembership, seedOrgDefaults, checkSlugAvailable } from "@/server/public-org";
import { getOrgCreationPolicy } from "@/server/site-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WizardRail } from "@/components/ui/wizard-rail";
import { AuthShell } from "../auth-playful";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { Loader2, Check, X } from "lucide-react";

const TOTAL_STEPS = 5;
const SLUG_CHECK_DEBOUNCE_MS = 400;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type SlugCheckStatus = "checking" | "available" | "taken";
type SlugStatus = "idle" | SlugCheckStatus;

/**
 * `/setup` — C1 (#1098), the wizard shell + step 0. Reached only from
 * `/welcome`'s "Set up a new company" card (B1, #1092). This step is the
 * ONLY blocking screen (D3): naming the org commits it for real —
 * `organization.create()` → `setActive()` → `mirrorMyMembership()` — so every
 * later screen (steps 1-4, not yet built — Phase C's #1099-#1104) is an
 * ordinary settings write against a live org rather than draft state.
 */
export default function SetupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeRequired, setCodeRequired] = useState(false);
  const [slugCheckStatus, setSlugCheckStatus] = useState<SlugCheckStatus>("checking");
  const slugCheckId = useRef(0);

  // Redirect away if the user already belongs to an org. Guard on a cancelled
  // flag: if the user navigates away before this async check resolves, the
  // late resolve must not fire router.replace and snap them back to /dashboard.
  useEffect(() => {
    let cancelled = false;
    getMyOrganizations().then((orgs) => {
      if (!cancelled && orgs.length > 0) router.replace("/dashboard");
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
        router.push("/dashboard");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

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
