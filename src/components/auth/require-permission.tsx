"use client";

import { useCanDo } from "@/lib/use-permissions";
import type { Resource } from "@/lib/permissions";

/**
 * Blocks access to a page if user lacks the required permission.
 * Shows an access denied message instead of the children.
 */
export function RequirePermission({
  resource,
  action,
  children,
}: {
  resource: Resource;
  action: string;
  children: React.ReactNode;
}) {
  const allowed = useCanDo(resource, action);

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="mt-2 text-sm text-fg-3">
          You don&apos;t have permission to access this page.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
