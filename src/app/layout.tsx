import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { GlobalErrorBoundary } from "@/components/error-boundary";
import { DomPatch } from "@/components/dom-patch";
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
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#0d9488" },
  ],
};

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      </head>
      <body
        className={`${dmSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <DomPatch />
        <GlobalErrorBoundary>
          <ThemeProvider>
            <QueryProvider>{children}</QueryProvider>
          </ThemeProvider>
        </GlobalErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
