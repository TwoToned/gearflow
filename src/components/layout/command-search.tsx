"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { useIsMobile } from "@/hooks/use-mobile";
import { ShellScan } from "@/components/scanner/shell-scan";
import { PaletteBody } from "@/components/layout/palette/palette-body";

/**
 * ⌘K / Ctrl+K toggles; a bare `/` opens straight into `/` actions — unless
 * focus is in a field, or the page has its own search box (`[data-search-input]`).
 */
function slashWouldSteal(): boolean {
  const active = document.activeElement as HTMLElement | null;
  const typing = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || !!active?.isContentEditable;
  return typing || document.querySelector("[data-search-input]") !== null;
}

function usePaletteHotkeys(open: (initialQuery: string) => void, toggle: () => void) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "k" && mod) {
        e.preventDefault();
        toggle();
      } else if (e.key === "/" && !mod && !slashWouldSteal()) {
        e.preventDefault();
        open("/");
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, toggle]);
}

const DESKTOP_TRIGGER =
  "hidden h-9 w-64 items-center gap-2 rounded-[var(--r)] border border-line bg-paper-2 px-3 text-[13px] text-muted transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red md:flex lg:w-80";

/**
 * The ⌘K palette's shell (UX Phase 11, §6d.3): the two triggers, the hotkeys,
 * the dialog (a full-screen sheet on a phone, §6d.6) and the shell Scan the
 * palette's `Scan a tag` opens (`ShellScan`, which mounts the camera ONLY while
 * open — the same one the bottom nav uses, never a second decoder). What it
 * shows lives in `palette/palette-body.tsx`, mounted per open and keyed by the
 * active org, so an org switch drops everything the old org showed.
 */
export function CommandSearch() {
  const isMobile = useIsMobile();
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const orgId = activeOrg?.id;

  const openWith = useCallback((q: string) => {
    setInitialQuery(q);
    setOpen(true);
  }, []);
  const toggle = useCallback(() => {
    setInitialQuery("");
    setOpen((o) => !o);
  }, []);
  usePaletteHotkeys(openWith, toggle);

  return (
    <>
      <button onClick={() => openWith("")} aria-label="Search or jump to (⌘K)" className={DESKTOP_TRIGGER}>
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-bg-inset px-1.5 font-mono text-[10px] font-medium text-fg-3 sm:flex">
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </button>
      <button
        onClick={() => openWith("")}
        className="flex h-11 w-11 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Search"
      >
        <Search className="h-5 w-5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className={`gap-0 overflow-hidden p-0 [&>button:last-child]:hidden [&>[data-radix-dialog-close]]:hidden ${isMobile ? "flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col rounded-none border-0" : "sm:max-w-lg"}`}
          style={isMobile ? { paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" } : undefined}
        >
          <DialogTitle className="sr-only">Search or jump to</DialogTitle>
          {open && (
            <PaletteBody
              key={orgId ?? "no-org"}
              orgId={orgId}
              userId={session?.user?.id}
              initialQuery={initialQuery}
              isMobile={isMobile}
              onClose={() => setOpen(false)}
              onScan={() => setScanOpen(true)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ShellScan open={scanOpen} onOpenChange={setScanOpen} />
    </>
  );
}
