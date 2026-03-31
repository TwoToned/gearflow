"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { SubHireForm } from "@/components/sub-hires/sub-hire-form";
import { FadeIn } from "@/components/ui/motion";
import { RequirePermission } from "@/components/auth/require-permission";

function NewSubHireContent() {
  const searchParams = useSearchParams();
  const defaultProjectId = searchParams.get("projectId") || undefined;

  return (
    <FadeIn>
      <RequirePermission resource="subHire" action="create">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
            <Link href="/sub-hires" className="hover:text-fg transition-colors">Sub-Hires</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-fg">New Sub-Hire</span>
          </div>
          <div>
            <h1 className="t-title text-fg">New Sub-Hire</h1>
            <p className="text-[13px] text-fg-3">
              Track gear rented from a supplier with cost and margin visibility.
            </p>
          </div>
          <SubHireForm defaultProjectId={defaultProjectId} />
        </div>
      </RequirePermission>
    </FadeIn>
  );
}

export default function NewSubHirePage() {
  return (
    <Suspense>
      <NewSubHireContent />
    </Suspense>
  );
}
