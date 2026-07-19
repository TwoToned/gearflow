"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { ProjectWizard } from "@/components/projects/project-wizard";
import { RequirePermission } from "@/components/auth/require-permission";

export default function NewTemplatePage() {
  return (
    <RequirePermission resource="project" action="create">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="t-title text-ink">New template</h1>
          <p className="t-body text-muted">
            Create a reusable project template. Dates are optional for templates.
          </p>
        </div>
        <ProjectWizard isTemplate />
      </div>
    </RequirePermission>
  );
}
