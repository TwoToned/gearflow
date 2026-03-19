"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  SECTION_TYPES,
  SECTION_TYPE_LABELS,
  SECTION_TYPE_DESCRIPTIONS,
  type SectionType,
} from "@/lib/pdfme/section-types";

interface SectionLibraryProps {
  onAddSection: (type: SectionType) => void;
}

export function SectionLibrary({ onAddSection }: SectionLibraryProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" />}>
        <Plus className="h-3.5 w-3.5" />
        Add Section
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Section</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5 pt-2">
          {SECTION_TYPES.map((type) => (
            <button
              key={type}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-primary/5 border border-transparent hover:border-border/50"
              onClick={() => {
                onAddSection(type);
                setOpen(false);
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">
                  {SECTION_TYPE_LABELS[type]}
                </div>
                <div className="text-xs text-fg-3 mt-0.5">
                  {SECTION_TYPE_DESCRIPTIONS[type]}
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
