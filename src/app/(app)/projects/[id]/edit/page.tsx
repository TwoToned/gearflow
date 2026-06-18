"use client";

import { use } from "react";
import Link from "next/link";
import { useProjectDetail } from "@/hooks/use-project-detail";
import { ProjectForm } from "@/components/projects/project-form";
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
import type { ProjectFormValues } from "@/lib/validations/project";

function toDateOrUndefined(
  val: string | Date | null | undefined
): Date | undefined {
  if (!val) return undefined;
  return typeof val === "string" ? new Date(val) : val;
}

export default function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data: project, isLoading } = useProjectDetail(id);

  if (isLoading)
    return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!project)
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Project not found.</p>
      </div>
    );

  const initialData: ProjectFormValues & { id: string } = {
    id: project.id,
    projectNumber: project.projectNumber,
    name: project.name,
    clientId: project.clientId || "",
    status: project.status,
    type: project.type,
    description: project.description || "",
    locationId: project.locationId || "",
    siteContactName: project.siteContactName || "",
    siteContactPhone: project.siteContactPhone || "",
    siteContactEmail: project.siteContactEmail || "",
    loadInDate: toDateOrUndefined(project.loadInDate as string | null),
    loadInTime: project.loadInTime || "",
    eventStartDate: toDateOrUndefined(
      project.eventStartDate as string | null
    ),
    eventStartTime: project.eventStartTime || "",
    eventEndDate: toDateOrUndefined(project.eventEndDate as string | null),
    eventEndTime: project.eventEndTime || "",
    loadOutDate: toDateOrUndefined(project.loadOutDate as string | null),
    loadOutTime: project.loadOutTime || "",
    rentalStartDate: toDateOrUndefined(
      project.rentalStartDate as string | null
    ),
    rentalEndDate: toDateOrUndefined(project.rentalEndDate as string | null),
    crewNotes: project.crewNotes || "",
    internalNotes: project.internalNotes || "",
    clientNotes: project.clientNotes || "",
    discountPercent: project.discountPercent
      ? Number(project.discountPercent)
      : undefined,
    depositPercent: project.depositPercent
      ? Number(project.depositPercent)
      : undefined,
    depositPaid: project.depositPaid
      ? Number(project.depositPaid)
      : undefined,
    invoicedTotal: project.invoicedTotal
      ? Number(project.invoicedTotal)
      : undefined,
    tags: project.tags || [],
  };

  const initialManagerIds = ((project as { projectManagers?: { user: { id: string } }[] }).projectManagers ?? []).map(
    (pm) => pm.user.id
  );

  return (
    <RequirePermission resource="project" action="update">
    <CanDo resource="project" action="update" fallback={<div className="p-8 text-center text-ui-text text-muted">You don&apos;t have permission to perform this action.</div>}>
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
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
          <ProjectForm initialData={initialData} initialManagerIds={initialManagerIds} />
        </div>
      </FadeIn>
    </CanDo>
    </RequirePermission>
  );
}
