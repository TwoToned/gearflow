import { redirect } from "next/navigation";

/** Check-off is a dialog on the Maintenance page now (UX Phase 14, 14a-3b, D44): old links and bookmarks open it there. */
export default function MaintenanceDueRedirect() {
  redirect("/maintenance?dialog=checkoff");
}
