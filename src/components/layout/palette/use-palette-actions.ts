"use client";

import { useRouter } from "next/navigation";
import type { PaletteRow } from "@/lib/palette/model";
import { pageRow } from "./use-at-mode";
import type { PageCommand } from "@/lib/page-commands";
import type { Drill, PaletteState } from "./use-palette-state";

/** Where Tab on `row` goes: a searchable `@` page's records, a page's sub-pages, or the row's children. */
function drillTarget(s: PaletteState, row: PaletteRow): { page: PageCommand } | Drill | null {
  const cmd = s.at.active ? s.at.matches.find((m) => `page-${m.command.href}` === row.id)?.command : undefined;
  if (cmd?.searchable) return { page: cmd };
  if (cmd?.children?.length) return { parent: row, rows: cmd.children.map((c) => pageRow(c)) };
  if (row.children?.length) return { parent: row, rows: row.children.map((c) => ({ ...c, isChild: undefined })) };
  return null;
}

/**
 * What a row does when chosen (Enter, a click, Tab), for one open palette:
 * open it (recording it in Recent), run its slash action, open Scan, expand
 * its group in place, or drill into it.
 */
export function usePaletteActions(s: PaletteState, opts: { isMobile: boolean; onClose: () => void; onScan: () => void }) {
  const router = useRouter();

  const exitDrill = () => {
    s.setDrill(null);
    s.setEntityPage(null);
    s.setDrillQuery("");
  };

  /** Tab (or a tap on a phone): into a searchable page's records, a page's sub-pages, or a row's children. */
  const enterDrill = (row: PaletteRow | undefined) => {
    const target = row ? drillTarget(s, row) : null;
    if (!target) return;
    s.setDrillQuery("");
    if ("page" in target) s.setEntityPage(target.page);
    else s.setDrill(target);
  };

  const open = (row: PaletteRow) => {
    if (!row.href) return;
    if (row.recent) s.recents.record(row.recent);
    opts.onClose();
    router.push(row.href);
  };

  const scan = () => {
    opts.onClose();
    opts.onScan();
  };

  const runAction = (row: PaletteRow): boolean => {
    const a = row.action;
    if (!a) return false;
    if (a.kind === "expand") s.setExpandedFamilies((f) => new Set([...f, a.family]));
    else if (a.kind === "scan") scan();
    else {
      opts.onClose();
      s.slash.run(a.commandId);
    }
    return true;
  };

  /** Enter / click. On a phone a row with children drills in instead of opening (kept from live). */
  const activate = (row: PaletteRow | undefined) => {
    if (!row || runAction(row)) return;
    if (opts.isMobile && row.hasChildren && !s.drilling) enterDrill(row);
    else open(row);
  };

  return { exitDrill, enterDrill, activate, scan };
}
