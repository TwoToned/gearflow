"use client";

import { useRouter } from "next/navigation";
import { AssetTable } from "@/components/assets/asset-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function RegistryPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/assets/registry/new"));

  return (
    <FadeIn>
      <RequirePermission resource="asset" action="read">
        <ListPageLayout
          title="Asset Registry"
          description="Every piece of gear your organisation owns, tracked individually."
        >
          <AssetTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
