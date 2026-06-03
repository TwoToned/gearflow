"use client";

/**
 * Add-group dialog launched from the equipment-tab toolbar. Picks a
 * destination category, an optional template, and the new group's
 * title. Extracted from equipment-tab.tsx in Phase 7.
 *
 * Form state lives in the body keyed by the open transition so each
 * fresh open resets cleanly. The parent owns the create mutation and
 * receives the form values via onSubmit.
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

interface CategoryOption {
  id: string;
  name: string;
}

export interface TemplateOption {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

export interface AddGroupValues {
  categoryId: string;
  title: string;
  templateId?: string;
}

interface AddGroupToolbarDialogProps {
  open: boolean;
  isPending: boolean;
  categories: CategoryOption[];
  templates: TemplateOption[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AddGroupValues) => void;
}

export function AddGroupToolbarDialog(props: AddGroupToolbarDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {props.open && <AddGroupToolbarDialogBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function AddGroupToolbarDialogBody({
  isPending,
  categories,
  templates,
  onOpenChange,
  onSubmit,
}: AddGroupToolbarDialogProps) {
  const [categoryId, setCategoryId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");

  function handleSubmit() {
    if (!title.trim() || !categoryId) return;
    onSubmit({
      categoryId,
      title: title.trim(),
      templateId: templateId || undefined,
    });
  }

  function handleTemplatePick(id: string) {
    setTemplateId(id);
    // Auto-fill title from the chosen template when title is still empty.
    if (id && !title.trim()) {
      const t = templates.find((o) => o.id === id);
      if (t) setTitle(t.name);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add Group</DialogTitle>
        <DialogDescription>
          Choose a category and name for the new group. Optionally start from a template.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-2">
          <Label>Category</Label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Select category...</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        {templates.length > 0 && (
          <div className="space-y-2">
            <Label>Template (optional)</Label>
            <select
              value={templateId}
              onChange={(e) => handleTemplatePick(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None (empty group)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.itemCount} {t.itemCount === 1 ? "item" : "items"})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-2">
          <Label>Group Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. PA System, Lighting Rig"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            autoFocus
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!title.trim() || !categoryId || isPending}
        >
          Create
        </Button>
      </DialogFooter>
    </>
  );
}
