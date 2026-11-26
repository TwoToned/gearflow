"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { TeamPage } from "@/components/settings/team/team-page";
import { FadeIn } from "@/components/ui/motion";

export default function TeamSettingsPage() {
  return (
    <FadeIn>
      <TeamPage />
    </FadeIn>
  );
}
