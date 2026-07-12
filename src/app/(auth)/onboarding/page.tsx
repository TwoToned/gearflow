"use client";

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

  // Redirect away if an org already exists. Guard on a cancelled flag: if the user
  // navigates away before this async check resolves, the late resolve must not fire
  // router.replace and snap them back to /dashboard.
  useEffect(() => {
    let cancelled = false;
    getTheOrgId().then((org) => {
      if (!cancelled && org) router.replace("/dashboard");
    });
    return () => {
      cancelled = true;
    };
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
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
          GF
        </div>
        <h2 className="t-title">Set up your instance</h2>
        <p className="text-sm text-fg-3">
          Create your organization to start managing gear and projects.
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
