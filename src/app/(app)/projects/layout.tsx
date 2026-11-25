import { Suspense } from "react";
import { TemplatesHost } from "@/components/projects/templates/templates-host";

/**
 * Every `/projects/*` page shares ONE Manage templates dialog / New template sheet
 * (`?templates=1|new`), so the Jobs list, a job, and the new-job wizard all open the same one
 * (UX Phase 9, D23). `useSearchParams` needs its Suspense boundary.
 */
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <TemplatesHost />
      </Suspense>
    </>
  );
}
