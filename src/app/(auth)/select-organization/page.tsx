"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { organization } from "@/lib/auth-client";
import { getMyOrganizations } from "@/server/public-org";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

/** Same allow-list as the login page's callbackUrl — only ever a same-origin
 *  relative path, never an open redirect. */
function safeCallbackUrl(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

type MyOrg = { id: string; name: string; slug: string; role: string };

function SelectOrganizationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyOrganizations().then((result) => {
      if (cancelled) return;
      // 0 or 1 memberships don't belong on this page — bounce to where they do.
      if (result.length === 0) {
        router.replace("/onboarding");
        return;
      }
      if (result.length === 1) {
        organization.setActive({ organizationId: result[0].id }).then(() => {
          router.replace(callbackUrl);
        });
        return;
      }
      setOrgs(result);
    });
    return () => {
      cancelled = true;
    };
  }, [router, callbackUrl]);

  const handleSelect = async (orgId: string) => {
    setActivatingId(orgId);
    try {
      await organization.setActive({ organizationId: orgId });
      // Always land on a tenant-neutral root — never carry an id from the
      // previous context into the newly-activated org (design doc §4.3.1).
      router.push(callbackUrl);
    } finally {
      setActivatingId(null);
    }
  };

  if (!orgs) {
    return (
      <FadeIn>
        <div className="flex justify-center rounded-lg bg-bg-surface p-8 surface-ring">
          <Loader2 className="h-8 w-8 animate-spin text-fg-3" />
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
        <div className="mb-6 text-center">
          <h2 className="t-title">Choose an organization</h2>
          <p className="text-sm text-fg-3">
            You belong to more than one organization. Pick one to continue.
          </p>
        </div>
        <div className="space-y-2">
          {orgs.map((org) => (
            <Button
              key={org.id}
              variant="line"
              className="flex w-full items-center justify-between"
              disabled={activatingId !== null}
              onClick={() => handleSelect(org.id)}
            >
              <span className="truncate">{org.name}</span>
              <span className="flex items-center gap-2 text-xs text-fg-3">
                {org.role}
                {activatingId === org.id && <Loader2 className="h-4 w-4 animate-spin" />}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </FadeIn>
  );
}

export default function SelectOrganizationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center rounded-lg bg-bg-surface p-8 surface-ring">
          <Loader2 className="h-8 w-8 animate-spin text-fg-3" />
        </div>
      }
    >
      <SelectOrganizationContent />
    </Suspense>
  );
}
