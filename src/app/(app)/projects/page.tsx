"use client";

/**
 * Projects list (RVLT Flow, DESIGN.md §15).
 * ProjectsPage → RequirePermission → ListPageLayout(title/desc) → ProjectTable
 * Keyboard: "n" → new project. Data table stays calm; chrome carries the brand.
 */

import { useRouter } from "next/navigation";
import { ProjectTable } from "@/components/projects/project-table";
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
          <ProjectTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
