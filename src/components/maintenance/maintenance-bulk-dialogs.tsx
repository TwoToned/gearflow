"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { plural } from "@/lib/list-write-toast";

/** Pure: a `yyyy-mm-dd` date input value as local-midnight epoch ms, or null when blank or not a date. */
function dateInputMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const ms = new Date(y, m - 1, d).getTime();
  return Number.isNaN(ms) ? null : ms;
}

interface ShellProps {
  /** Null = closed; the number of records the verb will touch. */
  count: number | null;
  onClose: () => void;
}

/** `Reschedule…`: one date for every selected open record. The page owns the write and its Undo. */
export function RescheduleDialog({ count, onClose, onSubmit }: ShellProps & { onSubmit: (ms: number) => Promise<void> }) {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const ms = dateInputMs(value);
  const submit = async () => {
    if (ms == null) return;
    setPending(true);
    try {
      await onSubmit(ms);
      setValue("");
      onClose();
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={count !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule {count !== null ? plural(count, "record") : ""}</DialogTitle>
          <DialogDescription>Moves the scheduled date. Finished and cancelled records are left as they are.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="reschedule-date">New date</Label>
          <Input id="reschedule-date" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={ms == null}>
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const UNASSIGNED = "__none__";

/** `Assign…`: one member (or nobody) for every selected open record. */
export function AssignDialog({ count, members, onClose, onSubmit }: ShellProps & { members: { id: string; name: string }[]; onSubmit: (userId: string | null) => Promise<void> }) {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const label = value === UNASSIGNED ? "Unassigned" : members.find((m) => m.id === value)?.name;
  const submit = async () => {
    setPending(true);
    try {
      await onSubmit(value === UNASSIGNED ? null : value);
      setValue("");
      onClose();
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={count !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {count !== null ? plural(count, "record") : ""}</DialogTitle>
          <DialogDescription>Finished and cancelled records are left as they are.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Assign to</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger aria-label="Assign to">
              <SelectValue placeholder="Choose a person">{label ?? "Choose a person"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={!value}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
