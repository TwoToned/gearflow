"use client";

import { useRouter } from "next/navigation";
import { ClientTable } from "@/components/clients/client-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

export default function ClientsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/clients/new"));

  return (
    <RequirePermission resource="client" action="read">
      <ListPageLayout
        title="Clients"
        description="Production companies, venues, and contacts."
      >
        <ClientTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
