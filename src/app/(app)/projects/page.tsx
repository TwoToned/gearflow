"use client";

import { useRouter } from "next/navigation";
import { ProjectTable } from "@/components/projects/project-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

export default function ProjectsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/projects/new"));

  return (
    <RequirePermission resource="project" action="read">
      <ListPageLayout
        title="Projects"
        description="Gigs, shows, and events — from enquiry to invoice."
      >
        <ProjectTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
