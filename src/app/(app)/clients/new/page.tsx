"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import Link from "next/link";
import { ClientForm } from "@/components/clients/client-form";
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

export default function NewClientPage() {
  return (
    <RequirePermission resource="client" action="create">
      <FadeIn>
        <div className="mx-auto max-w-5xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/clients" />}>Clients</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New client</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <PageHeader title="New client" description="Add a new client to your directory." />
          <ClientForm />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
