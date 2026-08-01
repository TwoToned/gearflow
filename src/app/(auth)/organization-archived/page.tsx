import Link from "next/link";
import { Archive } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

/**
 * Reached only via the `(app)` layout's gate when every one of the caller's
 * memberships is archived (#1075, A5) — an explanatory screen, not an empty
 * dashboard or a crash. Archiving is reversible (D12): a site admin can
 * unarchive the organization from `/admin/organizations`.
 */
export default function OrganizationArchivedPage() {
  return (
    <FadeIn>
      <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <Archive className="h-6 w-6" />
          </div>
          <h2 className="t-title">Organization archived</h2>
          <p className="text-sm text-fg-3">This organization is no longer active</p>
        </div>
        <div>
          <p className="text-sm text-fg-3 text-center">
            The organization you belong to has been archived by a site administrator.
            Its data is retained and access can be restored — contact your administrator
            if you believe this was unexpected.
          </p>
        </div>
        <div className="mt-6 flex justify-center">
          <Link href="/login" className="text-sm text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </FadeIn>
  );
}
