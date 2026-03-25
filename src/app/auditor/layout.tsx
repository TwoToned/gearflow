import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";

/**
 * Standalone layout for the auditor portal — no auth, no sidebar.
 */
export default function AuditorLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
