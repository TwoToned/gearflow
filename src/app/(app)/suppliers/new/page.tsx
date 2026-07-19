"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import Link from "next/link";
import { SupplierForm } from "@/components/suppliers/supplier-form";
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

export default function NewSupplierPage() {
  return (
    <RequirePermission resource="supplier" action="create">
      <FadeIn>
        <div className="mx-auto max-w-5xl space-y-4">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/suppliers" />}>Suppliers</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New supplier</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div>
            <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">New supplier</h1>
            <p className="mt-1 text-ui-text text-muted">
              Add a new supplier to your directory.
            </p>
          </div>
          <SupplierForm />
        </div>
      </FadeIn>
    </RequirePermission>
  );
}
