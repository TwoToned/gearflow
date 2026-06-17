import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk, Kalam, Geist_Mono } from "next/font/google";
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
    { media: "(prefers-color-scheme: dark)", color: "#141210" },
    { media: "(prefers-color-scheme: light)", color: "#F4EEE1" },
  ],
};

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const kalam = Kalam({
  variable: "--font-kalam",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const platformName = await getPlatformName();
  return {
    title: `${platformName} — Production Ops`,
    description:
      "Production operations software built by a live-events production company.",
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
        className={`${archivo.variable} ${hanken.variable} ${kalam.variable} ${geistMono.variable} antialiased`}
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
