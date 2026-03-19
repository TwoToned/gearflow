"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrganization } from "@/lib/auth-client";
import { getSupplierById } from "@/server/suppliers";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { FadeIn } from "@/components/ui/motion";

export default function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier, isLoading } = useQuery({
    queryKey: ["supplier", orgId, id],
    queryFn: () => getSupplierById(id),
  });

  if (isLoading) return <div className="text-fg-3">Loading...</div>;
  if (!supplier) return <div className="text-fg-3">Supplier not found.</div>;

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/suppliers" className="hover:text-fg transition-colors">Suppliers</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/suppliers/${id}`} className="hover:text-fg transition-colors">{supplier.name}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">Edit</span>
        </div>
        <div>
          <h1 className="t-title text-fg">Edit Supplier</h1>
          <p className="text-fg-3">
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
    </FadeIn>
  );
}
