import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { DynamicFavicon } from "@/components/layout/dynamic-favicon";
import { MobileNav } from "@/components/layout/mobile-nav";
import { BrandingProvider } from "@/components/providers/branding-provider";
import MiraContextProvider from "@/components/providers/mira-context-provider";
import { MiraLauncher } from "@/components/mira/mira-launcher";
import { getSession } from "@/lib/auth-server";
import { getTheOrg } from "@/lib/single-org";
import { OrgActivator } from "@/components/providers/org-activator";
import { PostHogIdentify } from "@/components/providers/posthog-identify";

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
      <SidebarProvider
        className="min-h-0 flex-1 md:min-h-svh"
        style={{ "--sidebar-width": "248px", "--sidebar-width-icon": "92px", "--sidebar-width-mobile": "248px" } as React.CSSProperties}
      >
        <BrandingProvider>
          <MiraContextProvider>
            <MiraLauncher />
            <OrgActivator />
            <PostHogIdentify />
            <DynamicFavicon />
            <AppSidebar />
            <SidebarInset className="min-h-0 min-w-0 overflow-x-clip">
              <TopBar />
              {/* Vertical scroll only. Horizontal is CLIPPED so wide content
                  (tables, etc.) can never shift the whole page left under the
                  fixed sidebar / sticky top bar. Wide tables scroll inside their
                  own overflow container (see ui/table.tsx). */}
              <main className="min-w-0 flex-1 overflow-y-auto overflow-x-clip p-4 md:p-6 animate-page-enter">{children}</main>
            </SidebarInset>
          </MiraContextProvider>
        </BrandingProvider>
      </SidebarProvider>
      <MobileNav />
    </div>
  );
}
