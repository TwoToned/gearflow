import { redirect } from "next/navigation";
import { templatesHref } from "@/lib/templates-url";

/**
 * `/projects/templates` is a deep link now, not a page (D23): templates are managed in the
 * `Manage templates…` dialog, which `/projects/layout.tsx` hosts. Kept so the nav row, the
 * palette, the slash command and bookmarks keep working.
 */
export default function TemplatesRedirect() {
  redirect(templatesHref("/projects"));
}
