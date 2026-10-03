"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import Link from "next/link";
import { GitBranch } from "lucide-react";
import { useRouter } from "next/navigation";
import { ClientTable } from "@/components/clients/client-table";
import { ClientsDashboard } from "@/components/clients/clients-dashboard";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/motion";

export default function ClientsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/clients/new"));

  return (
    <FadeIn>
      <RequirePermission resource="client" action="read">
        <ListPageLayout
          title="Clients"
          description="Production companies, venues, and contacts."
          actions={
            <Button variant="line" size="sm" asChild>
              <Link href="/clients/pipeline">
                <GitBranch className="h-4 w-4" />
                Pipeline
              </Link>
            </Button>
          }
        >
          <ClientsDashboard />
          <ClientTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
