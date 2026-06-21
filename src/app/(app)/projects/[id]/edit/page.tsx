"use client";

import { use } from "react";
import Link from "next/link";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { ProjectWizard, type EditableProject } from "@/components/projects/project-wizard";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data: project, isLoading } = useProjectDetail(id);

  if (isLoading)
    return <FadeIn><div className="mx-auto max-w-5xl"><FormSkeleton /></div></FadeIn>;
  if (!project)
    return (
      <div className="mx-auto max-w-5xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Project not found.</p>
      </div>
    );

  return (
    <RequirePermission resource="project" action="update">
    <CanDo resource="project" action="update" fallback={<div className="p-8 text-center text-ui-text text-muted">You don&apos;t have permission to perform this action.</div>}>
      <FadeIn>
        <div className="mx-auto max-w-5xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/projects" />}>Projects</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={`/projects/${project.id}`} />}>{project.name}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Edit</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div>
            <h1 className="t-title text-ink">Edit project</h1>
            <p className="t-body text-muted">
              <span className="t-mono">{project.projectNumber}</span> &middot; {project.name}
            </p>
          </div>
          <ProjectWizard project={project as EditableProject} />
        </div>
      </FadeIn>
    </CanDo>
    </RequirePermission>
  );
}
