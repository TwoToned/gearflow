"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import Link from "next/link";
import { CrewMemberForm } from "@/components/crew/crew-member-form";
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

export default function NewCrewMemberPage() {
  return (
    <RequirePermission resource="crew" action="create">
      <FadeIn>
        <div className="mx-auto max-w-5xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/crew" />}>Crew</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New member</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <PageHeader title="New crew member" description="Add a freelancer, employee, or contractor to your roster." />
          <CrewMemberForm />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
