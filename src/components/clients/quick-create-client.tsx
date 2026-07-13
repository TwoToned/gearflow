"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { useClientWrites } from "@/hooks/use-native-client-writes";
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

  const clientWrites = useClientWrites();
  const mutation = useServerMutation({
    mutationFn: () => clientWrites.create({ name, type, contactName: contactName || undefined, contactEmail: contactEmail || undefined }),
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
          <DialogTitle>New client</DialogTitle>
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
              className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="COMPANY">Company</option>
              <option value="INDIVIDUAL">Individual</option>
              <option value="VENUE">Venue</option>
              <option value="PRODUCTION_COMPANY">Production company</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-client-contact">Contact name</Label>
            <Input
              id="quick-client-contact"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Primary contact person"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-client-email">Contact email</Label>
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
            disabled={!name.trim()}
            loading={mutation.isPending}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
