"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import Link from "next/link";
import { ProjectWizard } from "@/components/projects/project-wizard";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function NewProjectPage() {
  return (
    <RequirePermission resource="project" action="create">
    <CanDo resource="project" action="create" fallback={<div className="mx-auto max-w-3xl py-8 text-center text-muted">You do not have permission to create projects.</div>}>
      <FadeIn>
        <div className="mx-auto max-w-5xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/projects" />}>Projects</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New job</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <PageHeader title="New job" description="A gig, show, or event — from enquiry to invoice." />
          <ProjectWizard />
        </div>
      </FadeIn>
    </CanDo>
    </RequirePermission>
  );
}
