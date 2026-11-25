"use client";

import { useState } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AssetQRCode } from "@/components/assets/asset-qr-code";

/**
 * The asset page's small dialogs (UX Phase 12, §9d): Retire (which alone holds Delete,
 * and only for a unit with no history), Move, Schedule service, and Print label. Each
 * confirms or collects one decision; the page owns the writes and their Undo.
 */

/**
 * Retire names what it ACTUALLY does (owner ruling Q-S2): status, test & tag, and what
 * follows from the status. It does not cancel services or detach accessories. Delete
 * lives here and nowhere else: it renders only when the server's own history rule says
 * the unit is a bare row (`canDelete`), as a second, explicit step.
 */
export function RetireDialog({
  open, onOpenChange, tag, deployed, canDelete, onRetire, onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: string;
  /** The unit is out on a job right now. */
  deployed: boolean;
  /** The server's answer (`assetDetail.bundle` facts); Delete is absent when false. */
  canDelete: boolean;
  onRetire: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [step, setStep] = useState<"retire" | "delete">("retire");
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setStep("retire"); }}>
      <DialogContent className="max-w-md">
        {step === "retire" ? (
          <>
            <DialogHeader>
              <DialogTitle>Retire {tag}?</DialogTitle>
              <DialogDescription>
                {deployed ? `${tag} is out on a job right now. ` : ""}It leaves the active registry and its test &amp; tag schedule is retired. Jobs that hold it
                will show short by 1, because availability follows its status. Its history, checks and test &amp; tag records are kept, and you can reinstate it from the Retired segment.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-between">
              {canDelete ? (
                <button type="button" onClick={() => setStep("delete")} className="min-h-11 text-left text-table-cell text-muted underline-offset-4 hover:text-t-out hover:underline">
                  Delete permanently instead…
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="button" loading={pending} onClick={() => void run(onRetire)}>Retire {tag}</Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete {tag} permanently?</DialogTitle>
              <DialogDescription>
                It has no history, so nothing else is lost. This removes the record and can&apos;t be undone. Retiring is the reversible choice.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="line" onClick={() => setStep("retire")}>Back</Button>
              <Button type="button" loading={pending} onClick={() => void run(onDelete)}>Delete {tag}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  open, onOpenChange, tag, currentLocationId, locations, onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: string;
  currentLocationId: string | null;
  locations: { id: string; name: string; type?: string; parent?: { name: string } | null }[];
  onMove: (locationId: string | null) => Promise<void>;
}) {
  const [to, setTo] = useState(currentLocationId ?? "");
  const [pending, setPending] = useState(false);
  const unchanged = (currentLocationId ?? "") === to;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move {tag}</DialogTitle>
          <DialogDescription>Sets its home location. A unit out on a job stays on that job.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Location</Label>
          <ComboboxPicker
            value={to}
            onChange={setTo}
            options={locations.map((l) => ({ value: l.id, label: l.parent ? `${l.parent.name} → ${l.name}` : l.name, description: l.type }))}
            placeholder="No location"
            searchPlaceholder="Search locations…"
            emptyMessage="No locations found."
            allowClear
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            loading={pending}
            disabled={unchanged}
            onClick={async () => {
              setPending(true);
              try { await onMove(to || null); onOpenChange(false); } finally { setPending(false); }
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduleServiceDialog({
  open, onOpenChange, tag, onSchedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag: string;
  onSchedule: (v: { title: string; scheduledDate: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("Service");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const valid = title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule a service for {tag}</DialogTitle>
          <DialogDescription>Creates a scheduled preventative maintenance job for this unit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-title">What</Label>
            <Input id="svc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-date">When</Label>
            <Input id="svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            loading={pending}
            disabled={!valid}
            onClick={async () => {
              setPending(true);
              try { await onSchedule({ title: title.trim(), scheduledDate: date }); onOpenChange(false); } finally { setPending(false); }
            }}
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A browser-print sheet: the tag as a QR plus the words, one per unit. No new PDF type (Q-7). */
export function PrintLabelDialog({ open, onOpenChange, tag, name }: { open: boolean; onOpenChange: (open: boolean) => void; tag: string; name: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Label for {tag}</DialogTitle>
          <DialogDescription>Print it, or download the QR code.</DialogDescription>
        </DialogHeader>
        <style>{`@media print { body * { visibility: hidden !important; } .asset-label-print, .asset-label-print * { visibility: visible !important; } .asset-label-print { position: fixed; left: 0; top: 0; } }`}</style>
        <div className="asset-label-print">
          <AssetQRCode assetTag={tag} label={name === tag ? tag : `${tag} · ${name}`} />
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
