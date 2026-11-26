import { redirect } from "next/navigation";

/** Create is a sheet over the Crew list now (UX Phase 13): this old route is a deep link that opens it. */
export default function NewCrewRedirect() {
  redirect("/crew?new=1");
}
