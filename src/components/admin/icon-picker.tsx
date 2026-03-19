"use client";

import { useState, useMemo } from "react";
import { icons } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const allIconNames = Object.keys(icons);

// Popular/suggested icons for quick access
const suggested = [
  "Clapperboard", "Zap", "Music", "Speaker", "Mic", "Video",
  "Camera", "Lightbulb", "Monitor", "Tv", "Radio", "Headphones",
  "Cable", "Plug", "Settings", "Wrench", "Hammer", "Gauge",
  "Box", "Package", "Truck", "Warehouse", "Building2", "Factory",
  "Star", "Shield", "Bolt", "Sparkles", "Crown", "Gem",
  "Rocket", "Target", "Flame", "Heart", "Atom", "Globe",
];

interface IconPickerProps {
  value: string | null;
  onChange: (icon: string | null) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return suggested.filter((n) => n in icons);
    const q = search.toLowerCase();
    return allIconNames
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [search]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-12 w-12 p-0"
          onClick={() => setOpen(true)}
        >
          {value ? (
            <DynamicIcon name={value} className="h-5 w-5" />
          ) : (
            <span className="text-xs text-fg-3">None</span>
          )}
        </Button>
        <div className="flex-1">
          <p className="text-sm font-medium">
            {value || "No icon selected"}
          </p>
          <p className="text-xs text-fg-3">
            Click to choose a Lucide icon
          </p>
        </div>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Choose an Icon</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
            <Input
              placeholder="Search icons..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="grid grid-cols-6 gap-1 p-1">
              {filtered.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-md p-2 hover:bg-accent transition-colors",
                    value === name && "bg-accent ring-2 ring-primary",
                  )}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                    setSearch("");
                  }}
                  title={name}
                >
                  <DynamicIcon name={name} className="h-5 w-5" />
                  <span className="text-[9px] text-fg-3 truncate w-full text-center">
                    {name}
                  </span>
                </button>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="text-center text-sm text-fg-3 py-8">
                No icons found. Try a different search term.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
