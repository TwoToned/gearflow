"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CrewMemberForm } from "@/components/crew/crew-member-form";
import { FadeIn } from "@/components/ui/motion";

export default function NewCrewMemberPage() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/crew" className="hover:text-fg transition-colors">Crew</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Member</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Crew Member</h1>
          <p className="text-[13px] text-fg-3">
            Add a new crew member to your directory.
          </p>
        </div>
        <CrewMemberForm />
      </div>
    </FadeIn>
  );
}
