import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { DynamicFavicon } from "@/components/layout/dynamic-favicon";
import { MobileNav } from "@/components/layout/mobile-nav";
import { BrandingProvider } from "@/components/providers/branding-provider";
import { getSession } from "@/lib/auth-server";
import { getTheOrg } from "@/lib/single-org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Single-org: if no org exists yet, redirect to onboarding
  const org = await getTheOrg();
  if (!org) {
    redirect("/onboarding");
  }

  return (
    <div className="app-shell flex flex-col overflow-hidden md:relative md:inset-auto md:block md:min-h-svh md:overflow-visible">
      <SidebarProvider className="min-h-0 flex-1 md:min-h-svh">
        <BrandingProvider>
          <DynamicFavicon />
          <AppSidebar />
          <SidebarInset className="min-h-0">
            <TopBar />
            <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
          </SidebarInset>
        </BrandingProvider>
      </SidebarProvider>
      <MobileNav />
    </div>
  );
}
