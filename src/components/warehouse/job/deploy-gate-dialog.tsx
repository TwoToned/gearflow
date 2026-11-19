"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Reason chips for leaving a DEFAULT accessory behind (§9.5). */
const LEAVE_REASONS = ["Still charging", "Out of stock", "Client supplies", "Not needed"] as const;

export interface GateAccessory {
  id: string;
  name: string;
  tier: "DEFAULT" | "OPTIONAL";
  /** Parent line the accessory rides with. */
  parentName: string;
  /** D9: the office's note on the plan, prefilled into the reason, editable. */
  officeNote: string;
}

export type GateDecision = { id: string; action: "pack" | "leave"; reason: string };

/** A DEFAULT left behind needs a reason; OPTIONAL and packed ones do not (§9.5). */
export function gateReady(rows: GateAccessory[], decisions: Record<string, GateDecision | undefined>): boolean {
  return rows.every((r) => {
    const d = decisions[r.id];
    if (!d) return false;
    return d.action === "pack" || r.tier === "OPTIONAL" || d.reason.trim().length > 0;
  });
}

/**
 * The deploy gate: shown ONLY when an accessory is unpacked or skipped. One row
 * per accessory with `Pack now` / `Leave`; leaving a DEFAULT asks why, with the
 * reason prefilled from the office note (D9) — still logged by the caller.
 */
export function DeployGateDialog({
  rows, onConfirm, onCancel,
}: {
  rows: GateAccessory[];
  onConfirm: (decisions: GateDecision[]) => void;
  onCancel: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, GateDecision | undefined>>({});
  const set = (r: GateAccessory, action: "pack" | "leave") =>
    setDecisions((p) => ({ ...p, [r.id]: { id: r.id, action, reason: p[r.id]?.reason || r.officeNote } }));
  const setReason = (id: string, reason: string) =>
    setDecisions((p) => (p[id] ? { ...p, [id]: { ...p[id]!, reason } } : p));
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Accessories not packed</DialogTitle></DialogHeader>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const d = decisions[r.id];
            return (
              <li key={r.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ui-text text-ink">{r.name} <span className="text-muted">· {r.parentName} · {r.tier}</span></span>
                  <Button size="sm" variant={d?.action === "pack" ? "primary" : "line"} onClick={() => set(r, "pack")}>Pack now</Button>
                  <Button size="sm" variant={d?.action === "leave" ? "primary" : "line"} onClick={() => set(r, "leave")}>Leave</Button>
                </div>
                {d?.action === "leave" && r.tier === "DEFAULT" && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-3">
                      {LEAVE_REASONS.map((c) => (
                        <button key={c} type="button" onClick={() => setReason(r.id, c)} className="min-h-8 border-b-2 border-transparent text-caption text-muted hover:text-ink">{c}</button>
                      ))}
                    </div>
                    <Input aria-label={`Reason for leaving ${r.name}`} value={d.reason} onChange={(e) => setReason(r.id, e.target.value)} placeholder="Why is it staying behind?" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="line" onClick={onCancel}>Cancel</Button>
          <Button disabled={!gateReady(rows, decisions)} onClick={() => onConfirm(Object.values(decisions).filter((x): x is GateDecision => !!x))}>Deploy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
