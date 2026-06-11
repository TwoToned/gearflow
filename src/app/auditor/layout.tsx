import type { ReactNode } from "react";

/**
 * Standalone layout for the auditor portal — no auth, no sidebar.
 */
export default function AuditorLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
