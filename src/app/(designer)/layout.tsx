import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";

export default async function DesignerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (!session.session.activeOrganizationId) {
    redirect("/no-organization");
  }

  return <>{children}</>;
}
