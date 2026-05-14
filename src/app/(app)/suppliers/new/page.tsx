"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { FadeIn } from "@/components/ui/motion";

export default function NewSupplierPage() {
  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/suppliers" className="hover:text-fg transition-colors">Suppliers</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Supplier</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Supplier</h1>
          <p className="t-body text-fg-3">
            Add a new supplier to your directory.
          </p>
        </div>
        <SupplierForm />
      </div>
    </FadeIn>
  );
}
