import { redirect } from "next/navigation";

/**
 * The run sheet is Logistics day mode now (UX Phase 5, D4): one rendering of
 * one data set, so this route only forwards old links and bookmarks. The
 * desktop print is `Print runsheet` in the Logistics tab menu (`?print=1`).
 */
export default async function RunsheetRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect("/projects/" + id + "?tab=labour");
}
