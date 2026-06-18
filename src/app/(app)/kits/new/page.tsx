"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { KitForm } from "@/components/kits/kit-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { cn, focusRing } from "@/lib/utils";

export default function NewKitPage() {
  return (
    <RequirePermission resource="kit" action="create">
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
          <nav className="mb-4 flex items-center gap-1 text-caption text-muted">
            <Link href="/kits" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>Kits</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-ink-2">New kit</span>
          </nav>
          <div>
            <h1 className="t-title text-ink">New kit</h1>
            <p className="t-body text-muted">
              Create a new kit or case to group assets together.
            </p>
          </div>
          <KitForm />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
