"use client";

import { useEffect } from "react";
import { icons } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrganization } from "@/hooks/use-organization";
import type { OrgBranding } from "@/lib/org-settings-types";
import { usePlatformBranding } from "@/lib/use-platform-name";

/**
 * Extract inner SVG paths from a Lucide icon by rendering to static markup.
 */
function getIconPaths(iconName: string): string | null {
  const IconComponent = icons[iconName as keyof typeof icons];
  if (!IconComponent) return null;

  const markup = renderToStaticMarkup(createElement(IconComponent, { size: 24 }));
  // Extract content between <svg ...> and </svg>
  const match = markup.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  return match?.[1] || null;
}

function buildFaviconSvg(iconPaths: string | null, color: string, fallbackLetter: string): string {
  if (iconPaths) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="6" fill="${color}"/>
      <g transform="translate(4, 4)" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        ${iconPaths}
      </g>
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="${color}"/>
    <text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="bold" font-size="18" fill="white">${fallbackLetter}</text>
  </svg>`;
}

/**
 * Dynamically sets the favicon using:
 * - Platform icon (Lucide icon name from site admin settings)
 * - Org primary color (from org branding settings)
 */
export function DynamicFavicon() {
  const { name: platformName, icon: platformIcon } = usePlatformBranding();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { data: org } = useOrganization(orgId);

  const settings = (org as Record<string, unknown>)?.settings as { branding?: OrgBranding } | undefined;
  const primaryColor = settings?.branding?.primaryColor || "#0d9488";

  useEffect(() => {
    const FAVICON_ID = "gearflow-dynamic-favicon";

    // Reuse our own managed element — never remove React-owned <link> nodes.
    // Removing nodes that React tracks in its fiber tree causes the
    // "Cannot read properties of null (reading 'removeChild')" crash
    // when the reconciler tries to manipulate the <head> on navigation.
    let link = document.getElementById(FAVICON_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = FAVICON_ID;
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }

    const iconPaths = platformIcon ? getIconPaths(platformIcon) : null;
    const fallbackLetter = platformName.charAt(0).toUpperCase();
    const svg = buildFaviconSvg(iconPaths, primaryColor, fallbackLetter);
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [platformIcon, primaryColor, platformName]);

  return null;
}
