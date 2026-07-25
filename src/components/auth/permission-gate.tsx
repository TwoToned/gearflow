"use client";

import { useCanDo, useIsViewer } from "@/lib/use-permissions";
import type { Resource } from "@/lib/permissions";

/**
 * Hide children if user lacks the given permission.
 * While loading, hides content (safe default).
 */
export function CanDo({
  resource,
  action,
  children,
  fallback = null,
}: {
  resource: Resource;
  action: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const allowed = useCanDo(resource, action);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

/**
 * Hide children from read-only users (viewers or custom roles with no write perms).
 * While loading role, hides content (safe default — don't flash buttons then hide).
 */
export function NotViewer({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const readOnly = useIsViewer();
  if (readOnly) return <>{fallback}</>;
  return <>{children}</>;
}
