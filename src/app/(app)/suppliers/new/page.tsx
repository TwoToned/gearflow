import { redirect } from "next/navigation";

/** Create is a sheet over the Suppliers list now (UX Phase 13): this old route is a deep link that opens it. */
export default function NewSupplierRedirect() {
  redirect("/suppliers?new=1");
}
