"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for the authenticated app shell.
 *
 * Why this exists: there was previously NO error.tsx anywhere, so any uncaught
 * client error inside a page (e.g. a Convex subscription throwing "Unauthorized"
 * during the brief auth-token flicker on first paint / token refresh) bubbled to
 * the framework, blanked the route, and the user's next move — a refresh — landed
 * them on `/` → `/dashboard`. That is the reported "kept getting sent back to the
 * home page". This boundary catches the error and lets the user (or the effect
 * below) recover IN PLACE, on the same URL, without losing their spot.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isTransientAuth = /unauthor|authentication required/i.test(
    error.message ?? "",
  );

  useEffect(() => {
    // Transient auth/loading errors resolve themselves once the Convex token
    // attaches — retry automatically a beat later instead of stranding the user.
    if (isTransientAuth) {
      const t = setTimeout(() => reset(), 600);
      return () => clearTimeout(t);
    }
  }, [isTransientAuth, reset]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="space-y-1.5">
        <h2 className="font-display text-[20px] font-extrabold tracking-tight text-ink">
          {isTransientAuth ? "Reconnecting…" : "Something went wrong"}
        </h2>
        <p className="max-w-sm text-[14px] text-muted">
          {isTransientAuth
            ? "Re-establishing your session. This page will refresh itself in a moment."
            : "This page hit an error. You can retry without losing your place."}
        </p>
      </div>
      {!isTransientAuth && (
        <Button variant="line" size="sm" onClick={() => reset()}>
          Try again
        </Button>
      )}
    </div>
  );
}
