"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

const shortcuts = [
  { keys: "⌘K", description: "Open search" },
  { keys: "N", description: "New item (on list pages)" },
  { keys: "?", description: "Show this dialog" },
] as const;

/**
 * Global keyboard shortcuts overlay.
 * Per DESIGN.md: `?` opens shortcuts overlay.
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useKeyboardShortcut("?", () => setOpen(true));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between py-1.5"
            >
              <span className="text-[13px] text-fg-2">{s.description}</span>
              <Kbd>{s.keys}</Kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
