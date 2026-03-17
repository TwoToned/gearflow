import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { getTheOrg } from "@/lib/single-org";

export default async function DesignerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const org = await getTheOrg();
  if (!org) {
    redirect("/onboarding");
  }

  return <>{children}</>;
}
