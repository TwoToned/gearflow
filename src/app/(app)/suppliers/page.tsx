"use client";

import { useRouter } from "next/navigation";
import { SupplierTable } from "@/components/suppliers/supplier-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function SuppliersPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/suppliers/new"));

  return (
    <FadeIn>
      <RequirePermission resource="supplier" action="read">
        <ListPageLayout
          title="Suppliers"
          description="Vendors and suppliers you purchase or hire from."
        >
          <SupplierTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
