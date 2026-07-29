"use client";

import { useState } from "react";
import { Check, Copy, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * The raw secret is shown exactly ONCE, at creation or rotation — the backend
 * never persists it, only its SHA-256 hash, so this dialog is the only chance
 * to copy it. No "reveal again" affordance exists anywhere else in the app.
 */
export function TokenRevealDialog({
  open,
  onOpenChange,
  token,
  keyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  keyName: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy the key manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This is the only time <strong>{keyName}</strong>&apos;s secret will ever be shown. Copy it
              now — it cannot be retrieved again, only rotated for a new one.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-paper-2 p-2.5 text-sm">
              {token}
            </code>
            <Button type="button" size="sm" variant="line" onClick={handleCopy} aria-label="Copy API key">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            I&apos;ve copied it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
