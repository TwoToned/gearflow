"use client";
// use-client: interactive — event handlers (client-only) (R-8.1.1)

import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="text-center space-y-4">
        <WifiOff className="mx-auto h-12 w-12 text-fg-3" />
        <h1 className="text-2xl font-bold">You&apos;re offline</h1>
        <p className="text-fg-3 max-w-sm">
          Check your internet connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
