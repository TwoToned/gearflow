"use client";

import { ProjectTable } from "@/components/projects/project-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function ProjectsPage() {
  return (
    <RequirePermission resource="project" action="read">
    <div className="space-y-4">
      <div>
        <h1 className="t-title text-fg">Projects</h1>
        <p className="text-[13px] text-fg-3">
          Gigs, shows, and events — from enquiry to invoice.
        </p>
      </div>
      <ProjectTable />
    </div>
    </RequirePermission>
  );
}
