"use client";
// use-client: client navigation hooks (useRouter) (R-8.1.1)

import { useRouter } from "next/navigation";
import { AssetsList } from "@/components/assets/assets-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function RegistryPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/assets/registry/new"));

  return (
    <FadeIn>
      <RequirePermission resource="asset" action="read">
        <AssetsList />
      </RequirePermission>
    </FadeIn>
  );
}
