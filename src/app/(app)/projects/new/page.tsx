"use client";

import { ProjectForm } from "@/components/projects/project-form";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";

export default function NewProjectPage() {
  return (
    <RequirePermission resource="project" action="create">
    <CanDo resource="project" action="create" fallback={<div className="mx-auto max-w-3xl py-8 text-center text-fg-3">You do not have permission to create projects.</div>}>
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="t-title text-fg">New Project</h1>
          <p className="text-[13px] text-fg-3">
            Create a new project for a gig, show, or event.
          </p>
        </div>
        <ProjectForm />
      </div>
    </CanDo>
    </RequirePermission>
  );
}
