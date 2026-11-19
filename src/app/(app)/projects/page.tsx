"use client";
// use-client: client navigation hooks (useRouter) (R-8.1.1)

import { useRouter } from "next/navigation";
import { JobsList } from "@/components/projects/jobs-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";

export default function ProjectsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/projects/new"));

  return (
    <FadeIn>
      <RequirePermission resource="project" action="read">
        <JobsList />
      </RequirePermission>
    </FadeIn>
  );
}
