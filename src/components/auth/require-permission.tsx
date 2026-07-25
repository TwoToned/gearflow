"use client";

import { useCurrentRole } from "@/lib/use-permissions";
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
  const { permissions, isLoading } = useCurrentRole();

  // While the role/permissions query is in flight, `permissions` is null —
  // rendering the denial here would flash "Access Denied" for every
  // authorized user on every gated page (56 call sites) before flipping to
  // the real content once it resolves. That's a spurious LCP/CLS candidate
  // on data-heavy dashboards (R-8.9.3 finding, #862) as well as a misleading
  // false negative. Render nothing until the check has actually run.
  if (isLoading || !permissions) return null;

  const allowed = permissions[resource]?.includes(action) ?? false;

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="t-title">Access Denied</h2>
        <p className="mt-2 t-body text-fg-3">
          You don&apos;t have permission to access this page.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
