"use client";

import { useCallback, useState } from "react";
import { useResolveScan, useReturnsWrites } from "@/hooks/use-returns";
import { useWarehouseWrites } from "@/hooks/use-warehouse-writes";
import { planReceive, receivedText, type ReceiveTarget } from "@/lib/floor-receive";
import type { ReturnCondition } from "@/lib/returning";

export interface ReceiveEntry {
  id: string;
  tone: "success" | "warning" | "error" | "neutral";
  text: string;
  /** The toast's own Undo closure (one closure, two surfaces). Only the latest entry keeps it. */
  undo?: () => Promise<void>;
  /** The returned serialised unit, so the strip's `Outcome ▾` can correct it. */
  returned?: Extract<ReceiveTarget, { kind: "asset" }>;
}

export interface WhichJob {
  label: string;
  options: ReceiveTarget[];
}

const MAX_ENTRIES = 5;
const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * The floor's `Receive` pipeline (spec §9c.4): ONE path for every scanned tag.
 * `returnsLookup.resolve` answers once; `planReceive` decides; then exactly one
 * announced write per kind: an asset through `checkInItems`, a kit through
 * `checkInKit`, a bulk tag through `returnBulk`. Each carries its toast's Undo,
 * handed to the strip unchanged. Notices never block the dock. Offline is
 * online-only in v1 (plan Q14): a neutral `not saved, scan again`.
 */
export function useReceiveScan(orgId: string | undefined) {
  const resolve = useResolveScan();
  const warehouse = useWarehouseWrites();
  const returns = useReturnsWrites();
  const [entries, setEntries] = useState<ReceiveEntry[]>([]);
  const [whichJob, setWhichJob] = useState<WhichJob | null>(null);

  const push = useCallback((e: Omit<ReceiveEntry, "id">) => {
    setEntries((prev) => [
      { ...e, id: `${Date.now()}-${prev.length}` },
      // Undo belongs only to the latest write.
      ...prev.map((p) => ({ ...p, undo: undefined })),
    ].slice(0, MAX_ENTRIES));
  }, []);

  const write = useCallback(
    async (t: ReceiveTarget, quantity?: number) => {
      try {
        let undo: (() => Promise<void>) | undefined;
        if (t.kind === "asset") {
          undo = (await warehouse.checkInItems(t.projectId, [{ lineItemId: t.lineItemId, assetId: t.assetId, returnCondition: "GOOD" }])).scanUndo;
        } else if (t.kind === "kit") {
          undo = (await warehouse.checkInKit(t.projectId, t.kitId, "GOOD")).scanUndo;
        } else {
          undo = (await returns.returnBulk({ bulkAssetId: t.bulkAssetId, projectId: t.projectId, quantity: quantity ?? t.quantity })).scanUndo;
        }
        push({ tone: "success", text: receivedText(t, quantity), undo, returned: t.kind === "asset" ? t : undefined });
      } catch (e) {
        push({ tone: "error", text: `${t.tag} · ${e instanceof Error ? e.message : "return failed"}` });
      }
    },
    [warehouse, returns, push],
  );

  const scan = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || !orgId) return;
      if (isOffline()) return push({ tone: "neutral", text: `${value} · offline · not saved, scan again` });
      let res;
      try {
        res = await resolve(orgId, value);
      } catch {
        return push({ tone: "error", text: `${value} · look up failed, scan again` });
      }
      const plan = planReceive(value, res);
      if (plan.type === "notice") return push({ tone: plan.tone, text: plan.text });
      if (plan.type === "choose") return setWhichJob({ label: plan.label, options: plan.options });
      await write(plan.target);
    },
    [orgId, resolve, push, write],
  );

  /** The strip's `Outcome ▾` on a just-returned unit. Its own toast carries Undo. */
  const setOutcome = useCallback(
    async (t: Extract<ReceiveTarget, { kind: "asset" }>, condition: ReturnCondition) => {
      try {
        await returns.correctCondition({ lineItemId: t.lineItemId, assetId: t.assetId, unitId: t.unitId, returnCondition: condition }, "GOOD");
      } catch (e) {
        push({ tone: "error", text: `${t.tag} · ${e instanceof Error ? e.message : "could not change the outcome"}` });
      }
    },
    [returns, push],
  );

  const raiseRepair = useCallback(
    async (t: Extract<ReceiveTarget, { kind: "asset" }>) => {
      try {
        await returns.raiseRepair({ projectId: t.projectId, label: t.label, assets: [{ assetId: t.assetId, assetTag: t.tag }] });
      } catch (e) {
        push({ tone: "error", text: `${t.tag} · ${e instanceof Error ? e.message : "could not raise the repair"}` });
      }
    },
    [returns, push],
  );

  const dismiss = useCallback((id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)), []);

  return { entries, scan, write, whichJob, closeWhichJob: () => setWhichJob(null), setOutcome, raiseRepair, dismiss };
}
