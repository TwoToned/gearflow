"use client";

import { useState, useEffect } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useIsViewer } from "@/lib/use-permissions";
import { SettingsCard } from "@/components/layout/page-layouts";

interface NotesEditorProps {
  title?: string;
  initialNotes: string;
  /** Called after a successful save so the parent can refresh its own view. */
  onChanged?: () => void;
  onSave: (notes: string) => Promise<unknown>;
  placeholder?: string;
  rows?: number;
}

export function NotesEditor({
  title = "Notes",
  initialNotes,
  onChanged,
  onSave,
  placeholder = "Add notes...",
  rows = 6,
}: NotesEditorProps) {
  const isViewer = useIsViewer();
  const [notes, setNotes] = useState(initialNotes);
  const hasChanges = notes !== initialNotes;

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const mutation = useServerMutation({
    mutationFn: () => onSave(notes),
    onSuccess: () => {
      onChanged?.();
      toast.success(`${title} saved`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isViewer) {
    return (
      <SettingsCard>
        <h3 className="t-heading text-fg mb-4">{title}</h3>
        <p className="whitespace-pre-wrap text-sm text-fg-3">
          {initialNotes || "No notes."}
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className="t-heading text-fg">{title}</h3>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !hasChanges}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {mutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
      />
    </SettingsCard>
  );
}
