import { redirect } from "next/navigation";

/** The Location sheet replaced this page (UX Phase 14): old links and bookmarks land on it, open. */
export default function NewLocationPage() {
  redirect("/locations?new=1");
}
