"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { getSupplierById } from "@/server/suppliers";
import { SupplierForm } from "@/components/suppliers/supplier-form";

export default function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier, isLoading } = useQuery({
    queryKey: ["supplier", orgId, id],
    queryFn: () => getSupplierById(id),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!supplier) return <div className="text-muted-foreground">Supplier not found.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">Edit Supplier</h1>
        <p className="text-muted-foreground">
          Update supplier details.
        </p>
      </div>
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
        isActive: supplier.isActive,
      }} />
    </div>
  );
}
