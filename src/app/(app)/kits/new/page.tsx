"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { KitForm } from "@/components/kits/kit-form";
import { FadeIn } from "@/components/ui/motion";

export default function NewKitPage() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/kits" className="hover:text-fg transition-colors">Kits</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Kit</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Kit</h1>
          <p className="t-body text-fg-3">
            Create a new kit or case to group assets together.
          </p>
        </div>
        <KitForm />
      </div>
    </FadeIn>
  );
}
