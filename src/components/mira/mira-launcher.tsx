"use client";

import dynamic from "next/dynamic";
import { Bot } from "lucide-react";
import { useMira } from "@/components/providers/mira-context-provider";
import { Button } from "@/components/ui/button";

// Deferred until Mira is actually opened — mira-context-provider.tsx's own
// note: keep the provider trivial, code-split the heavy assistant UI at its
// mount point. `ssr: false` because it only ever matters post-interaction.
const MiraPanel = dynamic(() => import("./mira-panel").then((m) => m.MiraPanel), { ssr: false });

/** The always-mounted trigger + the lazily-loaded panel it opens. Mounted
 *  once in the (app) layout, inside MiraContextProvider. */
export function MiraLauncher() {
  const mira = useMira();
  if (!mira) return null;

  return (
    <>
      {!mira.open && (
        <Button
          type="button"
          size="icon"
          aria-label="Ask Mira"
          onClick={() => mira.setOpen(true)}
          className="fixed bottom-20 right-4 z-50 h-11 w-11 rounded-full md:bottom-4"
        >
          <Bot className="h-5 w-5" />
        </Button>
      )}
      <MiraPanel />
    </>
  );
}
