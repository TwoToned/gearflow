import { redirect } from "next/navigation";

/** The Maintenance sheet replaced this page (UX Phase 14): old links and bookmarks land on the list with it open. */
export default function NewMaintenancePage() {
  redirect("/maintenance?new=1");
}
