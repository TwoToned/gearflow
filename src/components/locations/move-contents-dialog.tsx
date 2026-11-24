"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface MoveSource {
  id: string;
  name: string;
  stored: number;
}

export interface MoveDestination {
  id: string;
  name: string;
}

/** Pure: the destinations on offer (every location that is not one of the sources). */
export function destinationsFor(all: MoveDestination[], sources: MoveSource[]): MoveDestination[] {
  const taken = new Set(sources.map((s) => s.id));
  return all.filter((l) => !taken.has(l.id));
}

/**
 * `Move contents…` (row ⋯ and bulk): pick where everything stored at the selected locations goes. Units
 * out on a job, kit members and accessories stay put and are named in the toast afterwards. The page owns
 * the write and its Undo.
 */
export function MoveContentsDialog({
  sources,
  destinations,
  onClose,
  onMove,
}: {
  /** Null = closed. */
  sources: MoveSource[] | null;
  destinations: MoveDestination[];
  onClose: () => void;
  onMove: (toId: string) => Promise<void>;
}) {
  const [toId, setToId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const options = destinationsFor(destinations, sources ?? []);
  const total = (sources ?? []).reduce((n, s) => n + s.stored, 0);
  const label = options.find((o) => o.id === toId)?.name;

  const submit = async () => {
    setPending(true);
    try {
      await onMove(toId);
      setToId("");
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={sources !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move contents{sources && sources.length === 1 ? ` — ${sources[0].name}` : ` — ${sources?.length ?? 0} locations`}</DialogTitle>
          <DialogDescription>
            Everything stored here ({total} item{total === 1 ? "" : "s"}) moves to the place you choose. Units out on a job, kit members and accessories stay where they are.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Move to</Label>
          <Select value={toId} onValueChange={setToId}>
            <SelectTrigger aria-label="Move to">
              <SelectValue placeholder="Choose a location">{label ?? "Choose a location"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={!toId}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
