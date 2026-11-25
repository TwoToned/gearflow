import { redirect } from "next/navigation";

/** The registry IS the Test and tag list now (UX Phase 14, D44): old links and bookmarks land on its All word. */
export default function TestTagRegistryRedirect() {
  redirect("/test-and-tag?seg=all");
}
