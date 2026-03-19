"use client";

import { ProjectForm } from "@/components/projects/project-form";
import { RequirePermission } from "@/components/auth/require-permission";

export default function NewTemplatePage() {
  return (
    <RequirePermission resource="project" action="create">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="t-title text-fg">New Template</h1>
          <p className="text-[13px] text-fg-3">
            Create a reusable project template. Dates are optional for templates.
          </p>
        </div>
        <ProjectForm isTemplate />
      </div>
    </RequirePermission>
  );
}
