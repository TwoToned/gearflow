"use client";

import Link from "next/link";
import { ClientForm } from "@/components/clients/client-form";
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

export default function NewClientPage() {
  return (
    <RequirePermission resource="client" action="create">
      <FadeIn>
        <div className="mx-auto max-w-3xl space-y-4">
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
          <div>
            <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">New client</h1>
            <p className="mt-1 text-ui-text text-muted">
              Add a new client to your directory.
            </p>
          </div>
          <ClientForm />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
