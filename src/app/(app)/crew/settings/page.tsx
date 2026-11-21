import { redirect } from "next/navigation";

/**
 * `/crew/settings` became the Crew roles & rates sheet (UX Phase 15, spec
 * §9h.5, Q-I7). Old links, bookmarks and the crew page's "Roles" link keep
 * working: this is a server redirect that opens the sheet over the planner.
 */
export default function CrewSettingsRedirect() {
  redirect("/crew/planner?sheet=roles");
}
