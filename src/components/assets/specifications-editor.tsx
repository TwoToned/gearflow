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
              <span className="text-ui-text font-medium text-ink min-w-[120px]">{key}</span>
              <Input
                value={val}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              />
              <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`Remove ${key}`} onClick={() => removeSpec(key)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Key (e.g. Frequency response)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSpec())}
        />
        <Input
          placeholder="Value (e.g. 50Hz – 15kHz)"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSpec())}
        />
        <Button variant="line" size="icon" className="shrink-0" aria-label="Add specification" onClick={addSpec}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {entries.length === 0 && (
        <p className="text-caption text-muted">Add key-value pairs for technical specifications.</p>
      )}
    </div>
  );
}
