"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getClient } from "@/server/clients";
import { ClientForm } from "@/components/clients/client-form";
import { useActiveOrganization } from "@/lib/auth-client";
import type { ClientFormValues } from "@/lib/validations/client";

export default function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", orgId, id],
    queryFn: () => getClient(id),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!client) return <div className="text-muted-foreground">Client not found.</div>;

  const initialData: ClientFormValues & { id: string } = {
    id: client.id,
    name: client.name,
    type: client.type,
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
    defaultDiscount: client.defaultDiscount ? Number(client.defaultDiscount) : undefined,
    notes: client.notes || "",
    tags: client.tags,
    isActive: client.isActive,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">Edit Client</h1>
        <p className="text-muted-foreground">{client.name}</p>
      </div>
      <ClientForm initialData={initialData} />
    </div>
  );
}
