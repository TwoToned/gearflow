"use client";

import type { ReactNode } from "react";
import { ActionMenu } from "@/components/ui/action-menu";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { CONTAINER_KIND_WORDS } from "@/lib/packing-tab";

/**
 * A case card on the job's Packing tab (spec §7b.2): the case's name in mono,
 * its kind muted, `· in LX-02` when nested, `n lines · m packed`, and the
 * case ⋯ (absent without `project:manage_line_items`). The body is the
 * caller's line rows, or a quiet empty line. Phase 8 builds drag, sealing and
 * printing on this header.
 */
export function PackingCaseCard({
  label,
  kind,
  parentLabel,
  lineCount,
  packedCount,
  menu,
  children,
}: {
  label: string;
  kind?: keyof typeof CONTAINER_KIND_WORDS;
  parentLabel?: string | null;
  lineCount: number;
  packedCount: number;
  menu?: ActionMenuSpec;
  children?: ReactNode;
}) {
  const counts = `${lineCount} ${lineCount === 1 ? "line" : "lines"} · ${packedCount} packed`;
  return (
    <section aria-label={`Case ${label}`} className="overflow-hidden rounded-[var(--r-lg)] border border-line">
      <header className="flex min-h-11 items-center gap-2 bg-paper-2/60 py-1 pl-3 pr-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="truncate font-mono text-ui-text font-semibold text-ink">{label}</span>
          {kind && <span className="text-caption text-muted">{CONTAINER_KIND_WORDS[kind]}</span>}
          {parentLabel && <span className="text-caption text-muted">· in {parentLabel}</span>}
          <span className="t-mono text-muted">{counts}</span>
        </div>
        {menu && menu.items.length > 0 && <ActionMenu spec={menu} label={`${label} actions`} />}
      </header>
      {lineCount === 0 ? <p className="px-3 py-3 text-caption text-muted">Nothing planned in this case</p> : children}
    </section>
  );
}
