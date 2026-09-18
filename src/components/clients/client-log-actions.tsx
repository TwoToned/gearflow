"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Phone, Mail, StickyNote, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClientTimelineWrites } from "@/hooks/use-client-timeline-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";

type LogKind = "call" | "email" | "note";

const LOG_COPY: Record<LogKind, { title: string; description: string; placeholder: string; label: string; icon: typeof Phone }> = {
  call: { title: "Log a call", description: "A record of a call that happened outside Flow.", placeholder: "e.g. Called Sarah — she's happy with the quote, confirming budget internally.", label: "Log call", icon: Phone },
  email: { title: "Log an email", description: "A record of an email exchanged outside Flow.", placeholder: "e.g. Emailed the revised quote with the LED wall option.", label: "Log email", icon: Mail },
  note: { title: "Add a note", description: "Anything worth remembering about this client.", placeholder: "e.g. Prefers Friday afternoon calls.", label: "Add note", icon: StickyNote },
};

/** Log call / log email / add note (#1245, design §8.4) — Flow still doesn't
 *  email clients from this feature; this is a record, not a channel. Each
 *  becomes a timeline row via `clientTimelineWrites.ts`. */
export function ClientLogActions({ clientId }: { clientId: string }) {
  const writes = useClientTimelineWrites();
  const [open, setOpen] = useState<LogKind | null>(null);
  const [note, setNote] = useState("");

  const mutation = useServerMutation({
    mutationFn: () => {
      if (!open) throw new Error("Nothing to log");
      const text = note.trim();
      if (open === "call") return writes.logCall(clientId, text);
      if (open === "email") return writes.logEmail(clientId, text);
      return writes.addNote(clientId, text);
    },
    onSuccess: () => {
      toast.success(open ? LOG_COPY[open].title : "Logged");
      setOpen(null);
      setNote("");
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="line" size="sm">
            Log touch
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {(Object.keys(LOG_COPY) as LogKind[]).map((kind) => {
              const Icon = LOG_COPY[kind].icon;
              return (
                <DropdownMenuItem key={kind} onClick={() => setOpen(kind)}>
                  <Icon className="mr-2 h-4 w-4" />
                  {LOG_COPY[kind].label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{LOG_COPY[open].title}</DialogTitle>
                <DialogDescription>{LOG_COPY[open].description}</DialogDescription>
              </DialogHeader>
              <Textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={LOG_COPY[open].placeholder}
                rows={4}
              />
              <DialogFooter>
                <Button onClick={() => mutation.mutate()} disabled={!note.trim() || mutation.isPending}>
                  {LOG_COPY[open].label}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
