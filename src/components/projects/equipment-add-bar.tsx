"use client";

import * as React from "react";
import { useConvex } from "convex/react";
import { toast } from "sonner";

import { AddBar, type AddBarResult } from "@/components/ui/add-bar";
import { useLineItemWrites } from "@/hooks/use-line-item-writes";
import { lineItemSchema } from "@/lib/validations/line-item";
import { api } from "../../../convex/_generated/api";
import type { UnifiedAddKind } from "./unified-add-dialog";

/**
 * The Equipment tab's AddBar (spec §7.3). Enter adds a gear or kit line through
 * the SAME `lineItemWrites.add` / `addKit` the add dialogs use, with a blank
 * price so the server auto-prices under its own guard (a model with no rate
 * stays unpriced, never $0). A second Enter on the same result, and the
 * Sub-hire / Custom / Sale kinds, open the existing add dialog. It owns no
 * data: the dialog opener and `invalidate` are the tab's.
 */

const ADD_KINDS = [
  { key: "gear", label: "Gear" },
  { key: "kit", label: "Kit" },
  { key: "sub-hire", label: "Sub-hire" },
  { key: "custom", label: "Custom" },
  { key: "sale", label: "Sale" },
];

const DIALOG_KINDS: Record<string, UnifiedAddKind> = { "sub-hire": "sub-hire", custom: "custom", sale: "sale" };
const DIALOG_NOUN: Record<string, string> = { "sub-hire": "sub-hire item", custom: "custom item", sale: "sale item" };

/** The dialog kind for a result (`gear` is the dialog's `own-stock`). */
function dialogKindFor(result: AddBarResult): UnifiedAddKind {
  if (result.kind === "gear") return "own-stock";
  return (DIALOG_KINDS[result.kind] ?? result.kind) as UnifiedAddKind;
}

interface ModelHit {
  id: string;
  name: string;
  manufacturer?: string;
  isActive?: boolean;
  dailyRate?: number;
}
interface KitHit {
  id: string;
  name: string;
  assetTag: string;
}

export function EquipmentAddBar({
  projectId,
  orgId,
  versionId,
  disabledReason,
  invalidate,
  onOpenDialog,
}: {
  projectId: string;
  orgId?: string;
  versionId?: string;
  disabledReason?: string;
  invalidate: () => void;
  onOpenDialog: (kind: UnifiedAddKind, modelId?: string) => void;
}) {
  const convex = useConvex();
  const writes = useLineItemWrites();
  const labels = React.useRef(new Map<string, string>());

  const search = React.useCallback(
    async (query: string, kind: string | null): Promise<AddBarResult[]> => {
      if (kind && DIALOG_KINDS[kind]) {
        return [{ id: `dialog:${kind}`, kind, title: `Add "${query}" as a ${DIALOG_NOUN[kind]}`, detail: "Opens the form" }];
      }
      if (!orgId) return [];
      const out: AddBarResult[] = [];
      if (kind !== "kit") {
        const models = (await convex.query(api.search.models, { orgId, query })) as ModelHit[];
        for (const m of models.filter((x) => x.isActive === true).slice(0, 8)) {
          labels.current.set(m.id, m.name);
          out.push({
            id: m.id,
            kind: "gear",
            title: m.name,
            subtitle: m.manufacturer,
            detail: m.dailyRate != null ? `$${m.dailyRate}/day` : undefined,
          });
        }
      }
      if (kind !== "gear") {
        const kits = (await convex.query(api.search.kits, { orgId, query })) as KitHit[];
        for (const k of kits.slice(0, 5)) {
          labels.current.set(k.id, `${k.assetTag} - ${k.name}`);
          out.push({ id: k.id, kind: "kit", title: k.name, subtitle: k.assetTag, detail: "Kit" });
        }
      }
      return out;
    },
    [convex, orgId],
  );

  const add = React.useCallback(
    async (r: AddBarResult) => {
      if (DIALOG_KINDS[r.kind]) return onOpenDialog(dialogKindFor(r));
      if (!writes.enabled) return void toast.error("Not ready, try again in a moment.");
      try {
        // Blank price: the server auto-prices (and leaves a rate-less model unpriced).
        const res =
          r.kind === "kit"
            ? await writes.addKit(projectId, r.id, { pricingMode: "KIT_PRICE", kitLabel: labels.current.get(r.id) ?? r.title, versionId })
            : await writes.add(
                projectId,
                lineItemSchema.parse({ type: "EQUIPMENT", modelId: r.id, description: r.title, quantity: 1 }),
                { allowOverbook: false, forceSeparate: false, includeAccessories: true, versionId },
              );
        invalidate();
        const merged = "merged" in res && res.merged;
        toast.success(merged ? `${r.title}: combined with an existing line` : `Added ${r.title}`, {
          // Undoing a merge would delete the line it merged into, so only a fresh line gets Undo.
          action: merged
            ? undefined
            : {
                label: "Undo",
                onClick: () =>
                  void writes
                    .remove(res.id)
                    .then(invalidate)
                    .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not undo")),
              },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not add. Press Enter again to open the form.");
      }
    },
    [writes, projectId, versionId, invalidate, onOpenDialog],
  );

  return (
    <AddBar
      kinds={ADD_KINDS}
      search={search}
      onAdd={add}
      onOpenEditor={(r) => onOpenDialog(dialogKindFor(r), r.kind === "gear" ? r.id : undefined)}
      placeholder="Add gear, a kit, or type a name…"
      disabled={!!disabledReason}
      className="mt-3"
    />
  );
}
