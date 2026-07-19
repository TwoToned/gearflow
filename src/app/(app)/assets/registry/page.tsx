"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { useRouter } from "next/navigation";
import { AssetsView } from "@/components/assets/assets-view";
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
          title="Asset registry"
          description="Every piece of gear your organisation owns, tracked individually."
        >
          <AssetsView />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
