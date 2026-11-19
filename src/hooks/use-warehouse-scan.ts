"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanStripEntry } from "@/components/ui/scan-strip";
import type { ScanFeedbackKind } from "@/lib/scan-feedback";
import {
  classifyScan,
  type ScanContext,
  type ScanLookup,
  type ScanPlan,
  type ScanStage,
  type ScanTone,
} from "@/lib/warehouse-scan-classify";

/** What a stage writer reports back; the strip entry is built from it here, once. */
export interface ScanActOutcome {
  text: string;
  tone?: ScanTone;
  /** `AnnouncedWrite.scanUndo`, passed through UNCHANGED (same closure as the toast). */
  undo?: () => void | Promise<void>;
  /** Warning outcomes: queue/run the prep check. */
  action?: { label: string; onSelect: () => void | Promise<void> };
}

type Offer = Extract<ScanPlan, { kind: "offerAdd" }>;

/** Everything the page owns, injected so the pipeline is one testable unit. */
export interface WarehouseScanDeps {
  stage: ScanStage;
  /** `prep` writes for the stage; `check` resolves and shows, with NO write. */
  mode: "prep" | "check";
  lookup: (raw: string, stage: ScanStage) => Promise<ScanLookup>;
  context: () => ScanContext;
  setCase: (containerId: string) => void;
  verifyKitMember: (p: { kitId: string; assetId: string; name: string }) => void;
  actKit: (p: { kitId: string; lineItemId: string; name: string }) => Promise<ScanActOutcome>;
  act: (p: { lineItemId: string; assetId: string | null; name: string }) => Promise<ScanActOutcome>;
  /** Check-only: describe the item (flags, `Run check`) without writing. */
  describe: (p: { lineItemId: string; assetId: string | null; name: string }) => ScanActOutcome;
  addAndAct: (offer: Offer) => Promise<ScanActOutcome>;
  /** Neutral "not saved, needs signal" for the online-direct stages when offline. */
  isOffline?: () => boolean;
  play: (kind: ScanFeedbackKind) => void;
}

const FEEDBACK: Record<ScanTone, ScanFeedbackKind> = { success: "success", warning: "exception", error: "error", neutral: "info" };
const MAX_ENTRIES = 5;
const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * ONE scan pipeline for the warehouse job page (spec §5.7): wedge, camera and
 * dock all call `scan(raw)`. Every outcome becomes exactly one strip entry
 * synchronously with its tone, so a failed / waiting / needs-check scan is
 * visible within the same tick it resolves (§13), and `undo` is the caller's
 * `scanUndo` closure, never a second reverse.
 */
export function useWarehouseScan(deps: WarehouseScanDeps) {
  const [entries, setEntries] = useState<ScanStripEntry[]>([]);
  const seq = useRef(0);
  const d = useRef(deps);
  useEffect(() => { d.current = deps; });

  const push = useCallback((o: ScanActOutcome & { tone: ScanTone }, detail?: string) => {
    const id = `scan-${++seq.current}`;
    d.current.play(FEEDBACK[o.tone]);
    setEntries((prev) => [{ id, tone: o.tone, text: o.text, detail, undo: o.undo, action: o.action }, ...prev].slice(0, MAX_ENTRIES));
  }, []);

  const guarded = useCallback(async (run: () => Promise<ScanActOutcome>, failure: string) => {
    try {
      const o = await run();
      push({ ...o, tone: o.tone ?? "success" });
    } catch (e) {
      push({ text: errorText(e, failure), tone: "error" });
    }
  }, [push]);

  const handlers: Record<ScanPlan["kind"], (p: never) => void | Promise<void>> = {
    setCase: (p: Extract<ScanPlan, { kind: "setCase" }>) => { d.current.setCase(p.containerId); push({ text: `Active case: ${p.label}`, tone: "neutral" }); },
    verifyKitMember: (p: Extract<ScanPlan, { kind: "verifyKitMember" }>) => { d.current.verifyKitMember(p); push({ text: `Verified: ${p.name}`, tone: "success" }); },
    kit: (p: Extract<ScanPlan, { kind: "kit" }>) => guarded(() => d.current.actKit(p), "Failed to prep kit"),
    act: (p: Extract<ScanPlan, { kind: "act" }>) => guarded(async () => (d.current.mode === "check" ? d.current.describe(p) : d.current.act(p)), "Scan failed"),
    offerAdd: (p: Offer) => push({ text: `${p.name} is not on this job`, tone: "error", action: { label: "Add & prep", onSelect: () => guarded(() => d.current.addAndAct(p), "Could not add to job") } }),
    duplicate: (p: Extract<ScanPlan, { kind: "duplicate" }>) => push({ text: `${p.name} is already in this scan batch`, tone: "warning" }),
    refuse: (p: Extract<ScanPlan, { kind: "refuse" }>) => push({ text: p.text, tone: p.tone }),
  };

  const scan = useCallback(async (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    const { stage, lookup, context, isOffline } = d.current;
    let result: ScanLookup | null = null;
    const ctx = context();
    if (!ctx.containersByTag.has(tag)) {
      try {
        result = await lookup(tag, stage);
      } catch (e) {
        if (isOffline?.()) push({ text: `${tag} not saved — needs signal`, tone: "neutral" });
        else push({ text: errorText(e, "Scan failed"), tone: "error" });
        return;
      }
    }
    const plan = classifyScan(tag, result, stage, ctx);
    await (handlers[plan.kind] as (p: ScanPlan) => void | Promise<void>)(plan);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers read live deps through `d`
  }, [push, guarded]);

  const dismiss = useCallback((id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)), []);
  return { scan, entries, dismiss };
}
