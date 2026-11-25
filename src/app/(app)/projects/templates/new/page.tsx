import { redirect } from "next/navigation";
import { templatesHref } from "@/lib/templates-url";

/** `/projects/templates/new` opens the `New template…` sheet over the Jobs list (D23). */
export default function NewTemplateRedirect() {
  redirect(templatesHref("/projects", "", "new"));
}
