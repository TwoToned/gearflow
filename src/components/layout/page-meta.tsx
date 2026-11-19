"use client";

import { useEffect } from "react";
import { usePlatformName } from "@/lib/use-platform-name";
import { useBreadcrumbs } from "@/components/layout/breadcrumbs";

/**
 * Sets the document title and favicon dynamically, and names the record for the
 * top bar's breadcrumb trail (`useBreadcrumbs`) — so every detail page that already
 * renders <PageMeta title={record name} /> (Job, Asset, Client, Crew member, Kit …)
 * gets a real trail with no extra call. A list page's title is ignored by the trail
 * (it only fills an id segment).
 *
 * Usage: <PageMeta title="Pippin" /> → "Pippin — RVLT Flow"
 *        <PageMeta title="Settings" /> → "Settings — RVLT Flow"
 */
export function PageMeta({ title }: { title?: string }) {
  const platformName = usePlatformName();
  useBreadcrumbs(title);

  useEffect(() => {
    document.title = title
      ? `${title} — ${platformName}`
      : `${platformName} — Asset & Rental Management`;
  }, [title, platformName]);

  return null;
}
