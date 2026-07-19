"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { useRouter } from "next/navigation";
import { ProjectsView } from "@/components/projects/projects-view";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function ProjectsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/projects/new"));

  return (
    <FadeIn>
      <RequirePermission resource="project" action="read">
        <ListPageLayout
          title="Projects"
          description="Gigs, shows, and events — from enquiry to invoice."
        >
          <ProjectsView />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
