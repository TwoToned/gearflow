"use client";
// use-client: the index reads the search param (R-8.1.1)

import { Suspense } from "react";

import { SettingsIndex } from "@/components/settings/settings-index";
import { FadeIn } from "@/components/ui/motion";

/**
 * `/settings` is the settings INDEX (UX Phase 17, D57): one grouped list that
 * replaced the second rail and the phone jump-select. What used to live here —
 * General — moved to `/settings/general`.
 */
export default function SettingsIndexPage() {
  return (
    <FadeIn>
      <Suspense fallback={null}>
        <SettingsIndex />
      </Suspense>
    </FadeIn>
  );
}
