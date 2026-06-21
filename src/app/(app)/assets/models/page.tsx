"use client";

import { useRouter } from "next/navigation";
import { ModelTable } from "@/components/assets/model-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function ModelsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/assets/models/new"));

  return (
    <FadeIn>
      <RequirePermission resource="model" action="read">
        <ListPageLayout
          title="Equipment models"
          description="Templates for your equipment — each model defines a type of gear."
        >
          <ModelTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
