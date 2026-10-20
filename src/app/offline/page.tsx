"use client";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Public fallback: never reads identity, tenant data or local scan storage. */
export default function OfflinePage() {
  return <main className="flex min-h-svh items-center justify-center p-4">
    <div className="max-w-sm space-y-4 text-center">
      <WifiOff aria-hidden="true" className="mx-auto size-12 text-muted" />
      <h1 className="t-page-title">No signal in the dock</h1>
      <p className="t-reading-body text-muted">This offline screen is available. Project data and sign-in need a connection.</p>
      <p className="t-reading-body text-muted">Scans saved on this device remain pending until Flow reconnects and verifies the same account, organisation and project. Nothing is confirmed until the server acknowledges it.</p>
      <Button onClick={() => window.location.reload()}>Reconnect</Button>
    </div>
  </main>;
}
