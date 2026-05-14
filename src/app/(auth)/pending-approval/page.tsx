import Link from "next/link";
import { Clock } from "lucide-react";
import { FadeIn } from "@/components/ui/motion";

export default function PendingApprovalPage() {
  return (
    <FadeIn>
    <div className="rounded-lg bg-bg-surface p-6 surface-ring sm:p-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
          <Clock className="h-6 w-6" />
        </div>
        <h2 className="t-title">Pending Approval</h2>
        <p className="text-sm text-fg-3">Your account is awaiting administrator review</p>
      </div>
      <div>
        <p className="text-sm text-fg-3 text-center">
          You&apos;ve successfully authenticated, but an administrator needs to approve your
          access to this organization. You&apos;ll receive an email notification once your
          request has been reviewed.
        </p>
      </div>
      <div className="mt-6 flex justify-center">
        <Link
          href="/login"
          className="text-sm text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
    </FadeIn>
  );
}
