import { redirect } from "next/navigation";
import { isSiteAdmin } from "@/lib/admin-auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isSiteAdmin())) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
