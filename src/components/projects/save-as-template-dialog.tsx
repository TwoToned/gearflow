"use client";

/**
 * Save-group-as-template dialog — captures a ProjectGroup's
 * model-backed members as a reusable template. Extracted from
 * equipment-tab.tsx in Phase 7.
 *
 * Form state lives in the body keyed by the source group id so each
 * fresh open resets cleanly.
 */

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SaveAsTemplateValues {
  name: string;
  description?: string;
}

interface SaveAsTemplateDialogProps {
  /** Group being saved as a template. Null closes the dialog. */
  group: { id: string; title: string } | null;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (groupId: string, values: SaveAsTemplateValues) => void;
}

export function SaveAsTemplateDialog(props: SaveAsTemplateDialogProps) {
  return (
    <Dialog open={props.group != null} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        {props.group && <SaveAsTemplateDialogBody key={props.group.id} {...props} group={props.group} />}
      </DialogContent>
    </Dialog>
  );
}

function SaveAsTemplateDialogBody({
  group,
  isPending,
  onClose,
  onSubmit,
}: SaveAsTemplateDialogProps & { group: { id: string; title: string } }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit(group.id, {
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save as Template</DialogTitle>
        <DialogDescription>
          Save &quot;{group.title}&quot; as a reusable template. Only model-
          and kit-backed items are captured; free-text lines are skipped.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-2">
          <Label>Template name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Drum Mic Pack"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Description (optional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When to use this template..."
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!name.trim() || isPending}>
          {isPending ? "Saving..." : "Save Template"}
        </Button>
      </DialogFooter>
    </>
  );
}
