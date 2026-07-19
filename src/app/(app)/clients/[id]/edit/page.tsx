"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { use } from "react";
import Link from "next/link";
import { useClient } from "@/hooks/use-clients";
import { ClientForm } from "@/components/clients/client-form";
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
import type { ClientFormValues } from "@/lib/validations/client";
import { EditLockGate } from "@/components/collaboration/edit-lock-gate";

export default function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="client" action="update">
      <EditClientContent params={params} />
    </RequirePermission>
  );
}

function EditClientContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive read straight from Convex — edits by another user show live.
  const client = useClient(id);

  if (client === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!client) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Client not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been archived, or you don&apos;t have access to it.</p>
      </div>
    );
  }

  const initialData: ClientFormValues & { id: string } = {
    id: client.id,
    name: client.name,
    type: client.type ?? "COMPANY",
    contactName: client.contactName || "",
    contactEmail: client.contactEmail || "",
    contactPhone: client.contactPhone || "",
    billingAddress: client.billingAddress || "",
    billingLatitude: client.billingLatitude ?? null,
    billingLongitude: client.billingLongitude ?? null,
    shippingAddress: client.shippingAddress || "",
    shippingLatitude: client.shippingLatitude ?? null,
    shippingLongitude: client.shippingLongitude ?? null,
    taxId: client.taxId || "",
    paymentTerms: client.paymentTerms || "",
    defaultDiscount: client.defaultDiscount ?? undefined,
    notes: client.notes || "",
    tags: client.tags ?? [],
    isActive: client.isActive ?? true,
  };

  return (
    <FadeIn>
      <div className="mx-auto max-w-5xl space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/clients" />}>Clients</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/clients/${client.id}`} />}>{client.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Edit</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">Edit client</h1>
          <p className="mt-1 text-ui-text text-muted">{client.name}</p>
        </div>
        <EditLockGate entityType="client" entityId={id}>
          <ClientForm initialData={initialData} />
        </EditLockGate>
      </div>
    </FadeIn>
  );
}
