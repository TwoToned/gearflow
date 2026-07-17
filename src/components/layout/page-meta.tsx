"use client";

import { useEffect } from "react";
import { usePlatformName } from "@/lib/use-platform-name";

/**
 * Sets the document title and favicon dynamically.
 * Place in any page to override the default title.
 *
 * Usage: <PageMeta title="Pippin" /> → "Pippin — RVLT Flow"
 *        <PageMeta title="Settings" /> → "Settings — RVLT Flow"
 */
export function PageMeta({ title }: { title?: string }) {
  const platformName = usePlatformName();

  useEffect(() => {
    document.title = title
      ? `${title} — ${platformName}`
      : `${platformName} — Asset & Rental Management`;
  }, [title, platformName]);

  return null;
}
