"use client";

/**
 * Onboarding — first-run org creation (RVLT Flow, DESIGN.md §15.5 chrome).
 *
 * OnboardingPage
 * └── surface-ring card
 *     ├── Brand mark (red "R" tile) + Kalam eyebrow + title/sub
 *     └── Form (org name → auto-slug · URL slug · "Create organization")
 *
 * Single-org bootstrap: redirects to /dashboard once an org exists.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { organization } from "@/lib/auth-client";
import { getTheOrgId } from "@/server/public-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect away if an org already exists
  useEffect(() => {
    getTheOrgId().then((org) => {
      if (org) router.replace("/dashboard");
    });
  }, [router]);

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(slugify(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setLoading(true);
    try {
      const result = await organization.create({
        name: name.trim(),
        slug: slug.trim(),
      });
      if (result.error) {
        toast.error(result.error.message || "Failed to create organization");
      } else {
        // Set as active organization
        await organization.setActive({
          organizationId: result.data!.id,
        });
        toast.success("Organization created!");
        router.push("/dashboard");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border-2 border-border bg-red font-display text-[18px] font-black text-white shadow-[var(--sh-card),var(--lit)]">
          R
        </div>
        <p className="font-hand text-[16px] text-red">first the warehouse, then the world</p>
        <h2 className="t-title mt-1">Set up your warehouse</h2>
        <p className="mt-1 text-sm text-fg-3">
          Name your operation — gear, jobs and crew live under it.
        </p>
      </div>
      <div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization name</Label>
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
            <Label htmlFor="org-slug">URL slug</Label>
            <Input
              id="org-slug"
              type="text"
              placeholder="two-toned-productions"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
            <p className="text-xs text-fg-3">
              Used internally. Only lowercase letters, numbers, and hyphens.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create organization
          </Button>
        </form>
      </div>
    </div>
    </FadeIn>
  );
}
