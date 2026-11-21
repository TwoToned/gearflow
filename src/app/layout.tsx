import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { GoogleMapsProvider } from "@/components/providers/google-maps-provider";
import { GlobalErrorBoundary } from "@/components/error-boundary";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { DomPatch } from "@/components/dom-patch";
import { OverlayLockReset } from "@/components/overlay-lock-reset";
import { ReducedMotionProvider } from "@/components/ui/motion";
import { Toaster } from "@/components/ui/sonner";
import { getPlatformName } from "@/lib/platform";
import "./fonts";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a100d" },
    { media: "(prefers-color-scheme: light)", color: "#1a100d" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const platformName = await getPlatformName();
  return {
    title: `${platformName} — Asset & Rental Management`,
    description:
      "Professional asset and rental management for AV and theatre production companies.",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: platformName,
    },
    other: {
      "mobile-web-app-capable": "yes",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <DomPatch />
      </head>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <GlobalErrorBoundary>
          <OverlayLockReset />
          <PostHogProvider>
            <ThemeProvider>
              <GoogleMapsProvider>
                <ConvexClientProvider>
                  <ReducedMotionProvider>{children}</ReducedMotionProvider>
                </ConvexClientProvider>
              </GoogleMapsProvider>
            </ThemeProvider>
          </PostHogProvider>
          <Toaster />
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
