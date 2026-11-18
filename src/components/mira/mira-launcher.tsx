"use client";

import dynamic from "next/dynamic";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMira } from "@/components/providers/mira-context-provider";
import { useServerQuery } from "@/hooks/use-server-query";
import { isMiraConfigured } from "@/server/mira-settings";

// Deferred until Mira is actually opened — mira-context-provider.tsx's own
// note: keep the provider trivial, code-split the heavy assistant UI at its
// mount point. `ssr: false` because it only ever matters post-interaction.
const MiraPanel = dynamic(() => import("./mira-panel").then((m) => m.MiraPanel), { ssr: false });

/**
 * Mira is effectively DISABLED for an org until an admin connects an
 * OpenRouter key (`/settings/mira`) — no word, no panel, nothing to click.
 * `isMiraConfigured()` needs no permission (unlike the settings read, which
 * requires `orgSettings:read` most non-admin roles don't have) so every
 * member gets a consistent answer. Defaults to hidden while loading, same
 * posture as the Xero nav link's deployment-config gate, so the word never
 * flashes in only to disappear.
 */
function useMiraAvailable(): boolean {
  const mira = useMira();
  const { data: config } = useServerQuery({
    queryKey: ["mira-configured"],
    queryFn: () => isMiraConfigured(),
  });
  return !!mira && config?.configured === true;
}

/**
 * The `Mira` word in the top bar (D5) — a toggle for the panel, replacing the
 * floating action button that sat over every page (and over the bulk bar).
 * Icon-only on a phone (the word returns at 860px).
 */
export function MiraLauncher() {
  const mira = useMira();
  const available = useMiraAvailable();
  if (!mira || !available) return null;

  return (
    <button
      type="button"
      aria-label="Ask Mira"
      aria-pressed={mira.open}
      onClick={() => mira.setOpen(!mira.open)}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-1.5 rounded-[var(--r)] px-2 text-[13px] font-medium transition-colors max-md:size-11 max-md:justify-center",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
        mira.open ? "bg-elev text-ink" : "text-muted hover:bg-elev hover:text-ink",
      )}
    >
      <Bot className="size-4 shrink-0 max-md:size-5" aria-hidden />
      <span className="max-md:sr-only">Mira</span>
    </button>
  );
}

/** The lazily-loaded panel. Mounted once in the (app) layout, OUTSIDE the top bar:
 *  the bar's backdrop-filter would otherwise become the containing block of the
 *  panel's `fixed` positioning. */
export function MiraPanelHost() {
  const available = useMiraAvailable();
  return available ? <MiraPanel /> : null;
}
