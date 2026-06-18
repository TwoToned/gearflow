"use client";

import Link from "next/link";
import { CrewMemberForm } from "@/components/crew/crew-member-form";
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

export default function NewCrewMemberPage() {
  return (
    <RequirePermission resource="crew" action="create">
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
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
          <div>
            <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">New crew member</h1>
            <p className="mt-1 text-ui-text text-muted">
              Add a new crew member to your directory.
            </p>
          </div>
          <CrewMemberForm />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
