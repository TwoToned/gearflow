import { ExternalLink, FileText, Printer, Volume2 } from "lucide-react";

import type { DetailHeaderProps } from "@/components/ui/detail-header";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import { getStatusIntent } from "@/lib/status-colors";

/** What the warehouse header needs; the page computes the strings. */
export interface WarehouseHeaderInput {
  name: string;
  status: string;
  statusLabel: string;
  loadsOut?: string;
  truck?: string;
  packing?: string[];
  openDocument: (type: "pull-slip" | "delivery-docket" | "return-sheet" | "container-label") => void;
  hasContainers: boolean;
  onViewProject: () => void;
  feedback: { enabled: boolean; toggle: () => void };
  /** Admin overrides (ignore item state): each confirms before it runs. Omitted = absent. */
  overrides?: Array<{ key: string; label: string; title: string; body: string; run: () => void | Promise<void> }>;
}

const doc = (key: string, label: string, run: () => void): ActionItem => ({ key, label, group: "documents", icon: FileText, onSelect: run });

/**
 * Header props for the warehouse variant of `DetailHeader` (spec §5.9, §9.2):
 * title · status word · packer facts · `Documents ▾` · ⋯ (view job, scan sound,
 * admin overrides). Everything else lives on the card, not here.
 */
export function warehouseHeaderProps(i: WarehouseHeaderInput): DetailHeaderProps {
  const documents: ActionMenuSpec = {
    items: [
      doc("pull-slip", "Pull slip", () => i.openDocument("pull-slip")),
      doc("delivery-docket", "Delivery docket", () => i.openDocument("delivery-docket")),
      doc("return-sheet", "Return sheet", () => i.openDocument("return-sheet")),
      ...(i.hasContainers ? [doc("container-label", "Case labels", () => i.openDocument("container-label"))] : []),
    ],
  };
  const menu: ActionMenuSpec = {
    items: [
      { key: "view-job", label: "View job", group: "organise", icon: ExternalLink, onSelect: i.onViewProject },
      { key: "print", label: "Print pull slip", group: "documents", icon: Printer, onSelect: () => i.openDocument("pull-slip") },
      { key: "scan-sound", label: i.feedback.enabled ? "Scan sound: on" : "Scan sound: off", group: "reporting", icon: Volume2, onSelect: i.feedback.toggle },
      ...(i.overrides ?? []).map((o): ActionItem => ({
        key: o.key, label: o.label, group: "danger", danger: true, onSelect: o.run,
        confirm: { title: o.title, body: o.body, confirmLabel: o.label },
      })),
    ],
  };
  return {
    variant: "warehouse",
    title: i.name,
    status: { label: i.statusLabel, intent: getStatusIntent("project", i.status) },
    packerFacts: { loadsOut: i.loadsOut, truck: i.truck, packing: i.packing },
    documents,
    menu,
  };
}
