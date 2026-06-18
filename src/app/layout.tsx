import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Geist_Mono, Kalam, Baloo_2 } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { GoogleMapsProvider } from "@/components/providers/google-maps-provider";
import { GlobalErrorBoundary } from "@/components/error-boundary";
import { DomPatch } from "@/components/dom-patch";
import { OverlayLockReset } from "@/components/overlay-lock-reset";
import { ReducedMotionProvider } from "@/components/ui/motion";
import { Toaster } from "@/components/ui/sonner";
import { getPlatformName } from "@/lib/platform";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1a100d" },
    { media: "(prefers-color-scheme: light)", color: "#1a100d" },
  ],
};

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baloo2 = Baloo_2({
  variable: "--font-baloo-2",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const kalam = Kalam({
  variable: "--font-kalam",
  subsets: ["latin"],
  weight: ["400"],
});

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
        className={`${hankenGrotesk.variable} ${geistMono.variable} ${kalam.variable} ${baloo2.variable} antialiased`}
        suppressHydrationWarning
      >
        <GlobalErrorBoundary>
          <OverlayLockReset />
          <ThemeProvider>
            <GoogleMapsProvider>
              <ConvexClientProvider>
                <ReducedMotionProvider>{children}</ReducedMotionProvider>
              </ConvexClientProvider>
            </GoogleMapsProvider>
          </ThemeProvider>
          <Toaster />
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
