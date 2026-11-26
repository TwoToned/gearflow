"use client";
// use-client: client navigation hooks (useRouter) (R-8.1.1)

import { useRouter } from "next/navigation";
import { ClientsList } from "@/components/people/clients-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function ClientsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/clients?new=1"));

  return (
    <FadeIn>
      <RequirePermission resource="client" action="read">
        <ClientsList />
      </RequirePermission>
    </FadeIn>
  );
}
