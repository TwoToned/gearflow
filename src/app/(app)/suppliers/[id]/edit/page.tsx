"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useSupplier } from "@/hooks/use-suppliers";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";

export default function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive supplier (Convex) — the form only needs supplier fields, so a pure
  // useQuery against Convex is sufficient. undefined = loading, null = not found.
  const supplier = useSupplier(id);

  if (supplier === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
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
          isActive: supplier.isActive ?? true,
        }} />
      </div>
    </FadeIn>
  );
}
