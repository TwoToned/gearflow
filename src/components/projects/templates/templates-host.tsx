"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TEMPLATES_PARAM, templatesCloseHref } from "@/lib/templates-url";
import { ManageTemplatesDialog } from "./manage-templates-dialog";
import { NewTemplateSheet } from "./new-template-sheet";

/**
 * Hosts the Manage templates dialog and the New template sheet for every `/projects/*` page
 * (mounted once by `projects/layout.tsx`), driven by `?templates=1` and `?templates=new`. So the
 * `/projects/templates` redirect, the nav row, the palette and the wizard's own menu all open the
 * same dialog, over whatever page they were on.
 */
export function TemplatesHost() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = searchParams.get(TEMPLATES_PARAM);
  const close = () => router.replace(templatesCloseHref(pathname, searchParams));
  if (mode === "new") return <NewTemplateSheet onClose={close} />;
  return <ManageTemplatesDialog open={mode === "1"} onOpenChange={(o) => !o && close()} />;
}
