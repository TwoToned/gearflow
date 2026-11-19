"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const MAX_TAG_LENGTH = 40;

/** One tag, trimmed and bounded; empty is no tag. */
function normaliseTag(raw: string): string {
  return raw.trim().slice(0, MAX_TAG_LENGTH);
}

/**
 * The `Add tag…` prompt for a bulk bar (Jobs now, Assets next): one text box,
 * 16 px on a phone. Radix Dialog; the write itself is the caller's.
 */
export function TagPromptDialog({
  open,
  onOpenChange,
  count,
  noun,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  noun: string;
  onSubmit: (tag: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const tag = normaliseTag(value);
  const submit = () => {
    if (!tag) return;
    onSubmit(tag);
    setValue("");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add tag</DialogTitle>
          <DialogDescription>
            Adds the tag to {count} selected {noun}
            {count === 1 ? "" : "s"}. Ones that already have it are skipped.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Tag"
          autoFocus
          maxLength={MAX_TAG_LENGTH}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="text-base md:text-ui-text"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!tag} onClick={submit}>
            Add tag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
