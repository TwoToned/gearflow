"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FormSection } from "@/components/layout/page-layouts";
import { BrandingSettings } from "@/components/settings/branding-settings";
import {
  getOrganization,
  type OrgSettings,
} from "@/server/settings";
import { useActiveOrganization } from "@/lib/auth-client";
import { FadeIn } from "@/components/ui/motion";

export default function BrandingSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useQuery({
    queryKey: ["organization", orgId],
    queryFn: getOrganization,
  });

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || "");
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {});
    }
  }, [org]);

  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
      <FormSection
        title="Branding & Colors"
        description="Customize your organization's colors across the UI and PDF documents."
      >
        <div className="sm:col-span-2">
          <BrandingSettings
            orgName={name}
            settings={settings}
            onBrandingChange={(branding) => setSettings((prev) => ({ ...prev, branding }))}
          />
        </div>
      </FormSection>
    </div>
    </FadeIn>
  );
}
