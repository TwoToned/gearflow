"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useServerMutation } from "@/hooks/use-server-mutation";
import { useSupplierWrites } from "@/hooks/use-supplier-writes";
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

interface QuickCreateSupplierProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function QuickCreateSupplier({ open, onOpenChange, onCreated }: QuickCreateSupplierProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const supplierWrites = useSupplierWrites();
  const mutation = useServerMutation({
    mutationFn: () => supplierWrites.create({ name, phone: phone || undefined, email: email || undefined }),
    onSuccess: (result: { id: string }) => {
      toast.success("Supplier created");
      onCreated?.(result.id);
      onOpenChange(false);
      setName("");
      setPhone("");
      setEmail("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Supplier</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="quick-sup-name">Name *</Label>
            <Input
              id="quick-sup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jands"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  mutation.mutate();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-sup-phone">Phone</Label>
            <Input
              id="quick-sup-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quick-sup-email">Email</Label>
            <Input
              id="quick-sup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
