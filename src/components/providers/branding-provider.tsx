"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import { generatePrimaryPalette } from "@/lib/color-utils";
import type { OrgBranding } from "@/lib/org-settings-types";

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: org } = useOrganization(orgId);

  const branding = (org as Record<string, unknown>)?.settings as { branding?: OrgBranding } | undefined;
  const primaryColor = branding?.branding?.primaryColor;

  useEffect(() => {
    if (!primaryColor) return;

    const mode = resolvedTheme === "light" ? "light" : "dark";
    const overrides = generatePrimaryPalette(primaryColor, mode);

    const root = document.documentElement;
    const applied: string[] = [];

    for (const [prop, value] of Object.entries(overrides)) {
      root.style.setProperty(prop, value);
      applied.push(prop);
    }

    return () => {
      for (const prop of applied) {
        root.style.removeProperty(prop);
      }
    };
  }, [primaryColor, resolvedTheme]);

  return <>{children}</>;
}
