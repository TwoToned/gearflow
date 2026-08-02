"use client";

import dynamic from "next/dynamic";
import { Bot } from "lucide-react";
import { useMira } from "@/components/providers/mira-context-provider";
import { useServerQuery } from "@/hooks/use-server-query";
import { isMiraConfigured } from "@/server/mira-settings";
import { Button } from "@/components/ui/button";

// Deferred until Mira is actually opened — mira-context-provider.tsx's own
// note: keep the provider trivial, code-split the heavy assistant UI at its
// mount point. `ssr: false` because it only ever matters post-interaction.
const MiraPanel = dynamic(() => import("./mira-panel").then((m) => m.MiraPanel), { ssr: false });

/** The always-mounted trigger + the lazily-loaded panel it opens. Mounted
 *  once in the (app) layout, inside MiraContextProvider.
 *
 * Mira is effectively DISABLED for an org until an admin connects an
 * OpenRouter key (`/settings/mira`) — no button, no panel, nothing to click.
 * `isMiraConfigured()` needs no permission (unlike the settings read, which
 * requires `orgSettings:read` most non-admin roles don't have) so every
 * member gets a consistent answer. Defaults to hidden while loading, same
 * posture as the Xero nav link's deployment-config gate, so the button never
 * flashes in only to disappear. */
export function MiraLauncher() {
  const mira = useMira();
  const { data: config } = useServerQuery({
    queryKey: ["mira-configured"],
    queryFn: () => isMiraConfigured(),
  });

  if (!mira || config?.configured !== true) return null;

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
