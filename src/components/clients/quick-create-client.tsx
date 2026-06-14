"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { createClient } from "@/server/clients";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface QuickCreateClientProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function QuickCreateClient({ open, onOpenChange, onCreated }: QuickCreateClientProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"COMPANY" | "INDIVIDUAL" | "VENUE" | "PRODUCTION_COMPANY">("COMPANY");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const mutation = useServerMutation({
    mutationFn: () => createClient({ name, type, contactName: contactName || undefined, contactEmail: contactEmail || undefined }),
    onSuccess: (result) => {
      toast.success("Client created");
      onCreated?.(result.id);
      onOpenChange(false);
      setName("");
      setType("COMPANY");
      setContactName("");
      setContactEmail("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="quick-client-name">Name</Label>
            <Input
              id="quick-client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Productions"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  mutation.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-client-type">Type</Label>
            <select
              id="quick-client-type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="COMPANY">Company</option>
              <option value="INDIVIDUAL">Individual</option>
              <option value="VENUE">Venue</option>
              <option value="PRODUCTION_COMPANY">Production Company</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-client-contact">Contact Name</Label>
            <Input
              id="quick-client-contact"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Primary contact person"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-client-email">Contact Email</Label>
            <Input
              id="quick-client-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
