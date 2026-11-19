"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CameraScannerDialog } from "@/components/scanner/camera-scanner-dialog";
import { NavLink } from "@/components/layout/nav-link";
import { useScanTargetReader } from "@/components/scanner/scan-target";
import { useScanLookup, type ScanLookupState } from "@/hooks/use-scan-lookup";

const MESSAGE = {
  notFound: (v: string) => `Nothing matches "${v}". Check the tag and scan again.`,
  error: () => "Couldn't look that up. Check the connection and try again.",
  noPermission: () => "Your role can't look gear up. Ask an admin for warehouse access.",
} as const;

function ResultBody({ state, onRetry }: { state: ScanLookupState; onRetry: (value: string) => void }) {
  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 px-4 py-4 text-[14px] text-muted" role="status">
        <Loader2 className="size-4 animate-spin" /> Looking up {state.value}…
      </p>
    );
  }
  if (state.status === "found") {
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-[14px] text-ink"><span className="font-mono">{state.label}</span></p>
        <Button asChild size="lg" className="min-h-12 w-full"><NavLink href={state.url}>{state.cta}</NavLink></Button>
      </div>
    );
  }
  if (state.status === "idle") return null;
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <p className="text-[14px] text-ink-2" role="alert">{MESSAGE[state.status](state.value)}</p>
      {state.status === "error" && (
        <Button variant="line" size="lg" className="min-h-12 w-full" onClick={() => onRetry(state.value)}>Try again</Button>
      )}
    </div>
  );
}

/**
 * The shell's Scan: the camera (mounted ONLY while open, so every teardown path in
 * CLAUDE.md's five iOS rules is the dialog's own unmount) plus the lookup result
 * sheet. A page's registered ScanTarget handler (if any) receives the decoded value
 * and the lookup is skipped.
 */
export function ShellScan({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const readTarget = useScanTargetReader();
  const { state, run, reset } = useScanLookup();

  const onScan = (value: string) => {
    const handler = readTarget();
    if (handler) handler(value);
    else void run(value);
  };

  return (
    <>
      {open && <CameraScannerDialog open onOpenChange={onOpenChange} onScan={onScan} title="Scan a tag" />}
      <BottomSheet
        open={state.status !== "idle"}
        onOpenChange={(o) => {
          if (!o) reset();
        }}
        title="Scan result"
      >
        <ResultBody state={state} onRetry={(v) => void run(v)} />
        {state.status !== "idle" && state.status !== "loading" && (
          <div className="px-4 pb-2">
            <Button variant="ghost" className="min-h-11 w-full" onClick={() => { reset(); onOpenChange(true); }}>
              Scan another
            </Button>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
