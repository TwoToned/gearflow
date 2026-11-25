"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import Link from "next/link";
import { NewJobWizard } from "@/components/projects/new-job/new-job-wizard";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
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
    <CanDo resource="project" action="create" fallback={<div className="mx-auto max-w-3xl py-8 text-center text-muted">You do not have permission to create jobs.</div>}>
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/projects" />}>Jobs</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New job</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <NewJobWizard />
        </div>
      </FadeIn>
    </CanDo>
    </RequirePermission>
  );
}
