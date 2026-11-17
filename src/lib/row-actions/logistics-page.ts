import { CalendarClock, ClipboardList, Copy, FileText, MessageSquare, Printer, Send, Sparkles, Eye, EyeOff } from "lucide-react";

import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";

export interface LogisticsPageCtx {
  hasServices: boolean;
  hasWindow: boolean;
  offerCount: number;
  clashCount: number;
  crewCount: number;
  showCost: boolean;
  canEditProject: boolean;
  canEditCrew: boolean;
  /** Manager and above: cost and margin are hidden by default for everyone (playbook 3.7). */
  canSeeCost: boolean;
  onEditDates: () => void;
  onGenerate: () => void;
  onImport: () => void;
  onToggleCost: () => void;
  onCallSheet: () => void;
  onPrint: () => void;
  onMessage: () => void;
  onRequestAvailability: () => void;
  onOfferAll: () => void;
}

type Entry = ActionItem | false;

function offerItem(c: LogisticsPageCtx): Entry {
  const n = c.offerCount;
  const clash = c.clashCount > 0 ? " " + c.clashCount + " of them clash with other bookings (advisory: they are still sent)." : "";
  return (
    c.canEditCrew && n > 0 && {
      key: "offer-all",
      label: "Offer all · " + n,
      group: "edit",
      icon: Send,
      onSelect: c.onOfferAll,
      confirm: {
        title: "Send offers to " + n + " crew?",
        body: "Each pending assignment gets an email with accept and decline links." + clash,
        confirmLabel: "Send " + n,
      },
    }
  );
}

function editEntries(c: LogisticsPageCtx): Entry[] {
  return [
    c.canEditProject && { key: "dates", label: "Edit dates", group: "edit", icon: CalendarClock, onSelect: c.onEditDates },
    offerItem(c),
    c.canEditCrew && c.crewCount > 0 && { key: "message", label: "Message crew", group: "edit", icon: MessageSquare, onSelect: c.onMessage },
    c.canEditCrew && { key: "availability", label: "Request availability", group: "edit", icon: ClipboardList, onSelect: c.onRequestAvailability },
  ];
}

function organiseEntries(c: LogisticsPageCtx): Entry[] {
  return [
    c.canEditProject && c.hasWindow && {
      key: "generate",
      label: c.hasServices ? "Regenerate missing services" : "Generate services",
      group: "organise",
      icon: Sparkles,
      onSelect: c.onGenerate,
    },
    c.canEditProject && { key: "import", label: "Import services", group: "organise", icon: Copy, onSelect: c.onImport },
  ];
}

function documentEntries(c: LogisticsPageCtx): Entry[] {
  return [
    { key: "call-sheet", label: "Call sheet", group: "documents", icon: FileText, onSelect: c.onCallSheet },
    { key: "print", label: "Print runsheet", group: "documents", icon: Printer, onSelect: c.onPrint },
  ];
}

function costEntry(c: LogisticsPageCtx): Entry {
  return (
    c.canSeeCost && {
      key: "cost",
      label: c.showCost ? "Hide cost & margin" : "Show cost & margin",
      group: "reporting",
      icon: c.showCost ? EyeOff : Eye,
      onSelect: c.onToggleCost,
    }
  );
}

/** The tab's page menu: everything that is not about one row (spec 8: Show cost & margin, Generate missing, Import, runsheet). */
export function logisticsPageMenu(c: LogisticsPageCtx): ActionMenuSpec {
  const items = [...editEntries(c), ...organiseEntries(c), ...documentEntries(c), costEntry(c)];
  return { items: items.filter((i): i is ActionItem => !!i) };
}
