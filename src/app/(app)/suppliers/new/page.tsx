"use client";

import { SupplierForm } from "@/components/suppliers/supplier-form";

export default function NewSupplierPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Supplier</h1>
        <p className="text-[13px] text-fg-3">
          Add a new supplier to your directory.
        </p>
      </div>
      <SupplierForm />
    </div>
  );
}
