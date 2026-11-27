"use client";
// use-client: clipboard + dialog state (R-8.1.1)

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Chase (D54): show the follow-up text and `Copy`. It is COPY-ONLY: Flow never emails a client (decision 7,
 * #934), so there is no send button and no mail call anywhere on this path; the text is for the operator's
 * own email or message. The text carries a money line only when the caller was allowed to see money.
 */
export function ChaseDialog({ text, count, onOpenChange }: { text: string | null; count: number; onOpenChange: (open: boolean) => void }) {
  const copy = async () => {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(count > 1 ? `Copied ${count} follow-ups` : "Follow-up copied");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it by hand.");
    }
  };
  return (
    <Dialog open={text != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{count > 1 ? `Follow up ${count} items` : "Follow-up text"}</DialogTitle>
          <DialogDescription>Flow doesn&rsquo;t email your clients. Copy this into your own email or message.</DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          aria-label="Follow-up text"
          value={text ?? ""}
          rows={Math.min(14, Math.max(5, (text ?? "").split("\n").length + 1))}
          className="w-full rounded-[var(--r)] border border-line bg-paper-2 p-3 font-mono text-table-cell text-ink"
        />
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={copy}>
            <Copy className="mr-2 size-4" aria-hidden="true" />
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
