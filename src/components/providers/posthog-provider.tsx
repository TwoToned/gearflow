"use client";
// use-client: initialises the PostHog browser SDK (window-only) and captures
// SPA pageviews + Core Web Vitals — all client-side concerns.

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { logger } from "@/lib/logger";
import { capture, AnalyticsEvent } from "@/lib/analytics";

/**
 * PostHog analytics provider.
 *
 * Inert unless NEXT_PUBLIC_POSTHOG_KEY is set (dev/local without the key sends
 * nothing). Deliberately hardened for an internal, PII-heavy back-office app:
 *
 * - `autocapture: false` + `capture_pageview: false` — we never blanket-capture
 *   clicks/inputs (they'd carry names, emails, notes). Pageviews are sent
 *   manually below with the cuid-only path, never query strings that could leak.
 * - `disable_session_recording: true` — no replay, no DOM/PII capture.
 * - `mask_all_text` / `mask_all_element_attributes` — belt-and-braces if any
 *   capture path is ever enabled.
 * - `person_profiles: "identified_only"` — no anonymous person bloat.
 *
 * PII rule (R-8.12.4): event properties must stay cuid-only — enforced by
 * convention at emit sites (see src/lib/analytics.ts), not by the SDK.
 */
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// `||`, not `??`: an unset GitHub Actions repo variable is inlined at build
// time as an empty string, not undefined — `?? default` never catches that,
// so posthog-js gets api_host: "" and silently sends everything same-origin
// instead of to PostHog (production symptom: requests to /e, /array/*, /flags
// on this app's own domain, 307-redirected into the login page).
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

// The SDK (~50 KB gzip) is dynamically imported so it lands in its own async
// chunk, NOT the entry-route First Load JS (keeps the bundle-ratchet gate green).
let initState: "idle" | "loading" | "ready" | "inert" = "idle";
let initPromise: Promise<boolean> | null = null;

function ensureInit(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (initState === "ready") return Promise.resolve(true);
  if (initState === "inert") return Promise.resolve(false);
  if (initPromise) return initPromise;

  if (!posthogKey) {
    initState = "inert";
    if (process.env.NODE_ENV !== "production") {
      logger.warn(
        "[posthog] NEXT_PUBLIC_POSTHOG_KEY is not set — analytics provider is inert.",
      );
    }
    return Promise.resolve(false);
  }

  initState = "loading";
  initPromise = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(posthogKey, {
        api_host: posthogHost,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        // PostHog Error Tracking: capture uncaught errors + unhandled rejections
        // (client half of #650). Stack only — no DOM/PII (mask_all_* below).
        capture_exceptions: true,
        disable_session_recording: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        person_profiles: "identified_only",
        // Strip query strings before any event leaves the browser — URLs use
        // opaque cuids, but a stray ?email=… must never be sent.
        sanitize_properties: (props) => {
          for (const k of ["$current_url", "$referrer", "$pathname"]) {
            const v = props[k];
            if (typeof v === "string" && v.includes("?")) {
              props[k] = v.split("?")[0];
            }
          }
          return props;
        },
      });
      // Expose for the isomorphic capture() helper (src/lib/analytics.ts).
      window.posthog = posthog;
      initState = "ready";
      return true;
    })
    .catch((err) => {
      initState = "inert";
      logger.warn("[posthog] SDK failed to load — analytics disabled", { err });
      return false;
    });
  return initPromise;
}

function useCaptureWebVitals() {
  useReportWebVitals((metric) => {
    // Maps to the interactive-latency budget in docs/thresholds.md (T-9).
    // Await init so a vital that fires before the SDK chunk loads isn't lost.
    void ensureInit().then((ready) => {
      if (!ready) return;
      capture(AnalyticsEvent.WebVital, {
        metric: metric.name,
        value: Math.round(metric.value),
        rating: metric.rating,
        navigation_type: metric.navigationType,
      });
    });
  });
}

/**
 * Pageview tracker — isolated because useSearchParams() opts the subtree into
 * dynamic rendering and must sit under a Suspense boundary (Next build rule).
 * Keeping it a leaf means the app tree above is never suspended by it.
 */
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // searchParams is a dep so a param-only navigation still registers a view;
    // the value itself is never sent (sanitize_properties strips the query).
    void ensureInit().then((ready) => {
      if (ready) capture(AnalyticsEvent.PageView);
    });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useCaptureWebVitals();
  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  );
}
