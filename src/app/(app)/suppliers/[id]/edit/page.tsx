"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use } from "react";
import Link from "next/link";
import { useSupplier } from "@/hooks/use-suppliers";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="supplier" action="update">
      <EditSupplierContent params={params} />
    </RequirePermission>
  );
}

function EditSupplierContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive supplier (Convex) — the form only needs supplier fields, so a pure
  // useQuery against Convex is sufficient. undefined = loading, null = not found.
  const supplier = useSupplier(id);

  if (supplier === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!supplier) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Supplier not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
      </div>
    );
  }

  return (
    <FadeIn>
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/suppliers" />}>Suppliers</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/suppliers/${id}`} />}>{supplier.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader title="Edit supplier" description="Update supplier details." />
        <SupplierForm initialData={{
          id,
          name: supplier.name,
          contactName: supplier.contactName || "",
          email: supplier.email || "",
          phone: supplier.phone || "",
          website: supplier.website || "",
          address: supplier.address || "",
          latitude: supplier.latitude ?? null,
          longitude: supplier.longitude ?? null,
          notes: supplier.notes || "",
          accountNumber: supplier.accountNumber || "",
          paymentTerms: supplier.paymentTerms || "",
          defaultLeadTime: supplier.defaultLeadTime || "",
          tags: supplier.tags || [],
          isActive: supplier.isActive ?? true,
        }} />
      </div>
    </FadeIn>
  );
}
