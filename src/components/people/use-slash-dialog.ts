"use client";

import { useEffect } from "react";

/**
 * Listen for the palette's `open_dialog` slash commands (`window` `slash-command` events whose
 * `detail.dialog` names a dialog) and run the matching handler. The Crew list handles
 * `export-timesheets` (its page ⋯ dialog); `log-time` is a plain navigate to Timesheets now.
 */
export function useSlashDialog(handlers: Record<string, () => void>) {
  useEffect(() => {
    const onEvent = (e: Event) => {
      const dialog = (e as CustomEvent<{ dialog?: string } | undefined>).detail?.dialog;
      if (dialog && handlers[dialog]) handlers[dialog]();
    };
    window.addEventListener("slash-command", onEvent);
    return () => window.removeEventListener("slash-command", onEvent);
  }, [handlers]);
}
