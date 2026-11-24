"use client";
// use-client: live Convex data via client subscription (useQuery) + the URL state (R-8.1.1)

import { Suspense } from "react";
import { ScanPage } from "@/components/scan/scan-page";

/**
 * The Scan page (spec §9i, Phase 16): `/scan?mode=check|tt&tag=`. A thin shell: the
 * page reads its state from the URL, so it renders inside `Suspense` for
 * `useSearchParams`. Each mode is gated by its own permission inside the page (a user
 * sees only the modes they hold).
 */
export default function ScanRoute() {
  return (
    <Suspense fallback={null}>
      <ScanPage />
    </Suspense>
  );
}
