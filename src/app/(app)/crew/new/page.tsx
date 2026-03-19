"use client";

import { CrewMemberForm } from "@/components/crew/crew-member-form";

export default function NewCrewMemberPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Crew Member</h1>
        <p className="text-muted-foreground">
          Add a new crew member to your directory.
        </p>
      </div>
      <CrewMemberForm />
    </div>
  );
}
