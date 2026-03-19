"use client";

import { ProjectTable } from "@/components/projects/project-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";

export default function ProjectsPage() {
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
