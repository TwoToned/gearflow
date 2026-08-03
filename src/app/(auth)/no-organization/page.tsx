import { redirect } from "next/navigation";

// A user with zero orgs is never stranded here (#1092, B1) — this becomes
// the create-vs-join fork, not a dead end.
export default function NoOrganizationPage() {
  redirect("/welcome");
}
