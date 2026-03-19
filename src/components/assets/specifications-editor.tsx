"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SpecificationsEditorProps {
  value: Record<string, string>;
  onChange: (specs: Record<string, string>) => void;
}

export function SpecificationsEditor({ value, onChange }: SpecificationsEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const entries = Object.entries(value);

  function addSpec() {
    if (!newKey.trim()) return;
    onChange({ ...value, [newKey.trim()]: newValue.trim() });
    setNewKey("");
    setNewValue("");
  }

  function removeSpec(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-sm font-medium min-w-[120px]">{key}</span>
              <Input
                value={val}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                className="h-8 text-sm"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeSpec(key)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Key (e.g. Frequency Response)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="h-8 text-sm"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSpec())}
        />
        <Input
          placeholder="Value (e.g. 50Hz - 15kHz)"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="h-8 text-sm"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSpec())}
        />
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={addSpec}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {entries.length === 0 && (
        <p className="text-xs text-fg-3">Add key-value pairs for technical specifications.</p>
      )}
    </div>
  );
}
