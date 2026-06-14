"use client";

import { use } from "react";
import Link from "next/link";
import { useClient } from "@/hooks/use-clients";
import { ClientForm } from "@/components/clients/client-form";
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
  const { id } = use(params);

  // Reactive read straight from Convex — edits by another user show live.
  const client = useClient(id);

  if (client === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!client) return <div className="text-fg-3">Client not found.</div>;

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
      <div className="mx-auto max-w-3xl space-y-4">
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
          <h1 className="t-title text-fg">Edit Client</h1>
          <p className="t-body text-fg-3">{client.name}</p>
        </div>
        <EditLockGate entityType="client" entityId={id}>
          <ClientForm initialData={initialData} />
        </EditLockGate>
      </div>
    </FadeIn>
  );
}
