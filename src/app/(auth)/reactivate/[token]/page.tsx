"use client";
// use-client: interactive — React state (client-only) (R-8.1.1)

import { useState, use } from "react";
import { useRouter } from "next/navigation";
import { reactivateOrganizationByToken } from "@/server/org-dormancy";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

/**
 * B4 (#1096) — the confirm screen behind the link in `dormancyArchivedEmail`.
 * Mirrors `(auth)/invite/[id]/page.tsx`'s shape: load → explicit confirm
 * button → server action, rather than reactivating on a bare GET (a link
 * scanner/prefetcher hitting this URL must not silently undo the archive).
 */
export default function ReactivateOrganizationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: true; orgName: string } | { ok: false; error: string } | null>(null);

  const handleReactivate = async () => {
    setLoading(true);
    try {
      const res = await reactivateOrganizationByToken(token);
      setResult(res);
    } catch {
      setResult({ ok: false, error: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  if (result?.ok) {
    return (
      <FadeIn>
        <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center space-y-4">
          <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
          <div>
            <h2 className="text-lg font-semibold">{result.orgName} reactivated</h2>
            <p className="text-sm text-fg-3">Your organization is back — sign in to pick up where you left off.</p>
          </div>
          <Button className="w-full" onClick={() => router.push("/login")}>
            Sign in
          </Button>
        </div>
      </FadeIn>
    );
  }

  if (result && !result.ok) {
    return (
      <FadeIn>
        <div className="rounded-lg bg-bg-surface p-8 surface-ring text-center space-y-4">
          <XCircle className="mx-auto h-12 w-12 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">Cannot reactivate</h2>
            <p className="text-sm text-fg-3">{result.error}</p>
          </div>
          <Button variant="line" onClick={() => router.push("/login")}>
            Back to sign in
          </Button>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <RotateCcw className="h-6 w-6" />
          </div>
          <h2 className="t-title">Reactivate organization</h2>
          <p className="text-sm text-fg-3">
            This organization was archived after 30 days of inactivity. Nothing was deleted —
            reactivating restores full access immediately.
          </p>
        </div>
        <Button className="w-full" onClick={handleReactivate} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Reactivate this organization
        </Button>
      </div>
    </FadeIn>
  );
}
