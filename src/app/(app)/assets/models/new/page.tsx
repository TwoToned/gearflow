import { redirect } from "next/navigation";

/** Create is a sheet over the Models list now (UX Phase 12, D62): this old route is a deep link that opens it. */
export default function NewModelRedirect() {
  redirect("/assets/models?new-model=1");
}
