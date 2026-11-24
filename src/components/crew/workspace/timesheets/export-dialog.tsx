"use client";

import * as React from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Export all… (live): a date range for the server CSV (`/api/crew/timesheet`).
 * The server decides the pay columns. Ticked rows export from the bulk bar.
 */
export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const run = () => {
    const params = new URLSearchParams();
    if (from) params.set("dateFrom", from);
    if (to) params.set("dateTo", to);
    window.open(`/api/crew/timesheet${params.size ? `?${params}` : ""}`, "_blank");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export timesheets</DialogTitle>
          <DialogDescription>Leave both empty to export every entry. Ticked rows export from the bulk bar instead.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="export-from">From</Label>
            <Input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="export-to">To</Label>
            <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={run}>
            <Download className="size-5" aria-hidden="true" />
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
