"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { useEffect, useState } from "react";

import { FormSection, SettingsCard } from "@/components/layout/page-layouts";
import { BrandingSettings } from "@/components/settings/branding-settings";
import { DocumentSettings } from "@/components/settings/document-settings";
import type { OrgSettings } from "@/lib/org-settings-types";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import { FadeIn } from "@/components/ui/motion";

export default function BrandingSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: org } = useOrganization(orgId);

  const [name, setName] = useState("");
  const [settings, setSettings] = useState<OrgSettings>({});

  useEffect(() => {
    if (org) {
      setName((org as Record<string, unknown>).name as string || ""); // eslint-disable-line react-hooks/set-state-in-effect
      setSettings((org as Record<string, unknown>).settings as OrgSettings || {}); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [org]);

  return (
    <FadeIn>
    <div className="space-y-6">
      <SettingsCard>
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
      </SettingsCard>

      <SettingsCard>
        <FormSection
          title="Documents"
          description="Footer text and quote terms shown on generated PDF documents."
        >
          <div className="sm:col-span-2">
            <DocumentSettings
              orgName={name}
              settings={settings}
              onDocumentsChange={(documents) => setSettings((prev) => ({ ...prev, documents }))}
            />
          </div>
        </FormSection>
      </SettingsCard>
    </div>
    </FadeIn>
  );
}
