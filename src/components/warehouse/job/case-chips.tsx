"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContainerChoice } from "@/lib/warehouse-container-choice";

export interface CaseChip {
  id: string;
  label: string;
  /** Units packed into it. */
  packed: number;
  sealed?: boolean;
}

/**
 * The next choice after a click: picking the active chip again CLEARS it
 * (back to "nothing chosen", so the PM's plan applies — 2c); Loose is `null`
 * and clears the same way.
 */
export function nextCaseChoice(current: ContainerChoice, clicked: string | null): ContainerChoice {
  return current === clicked ? undefined : clicked;
}

/** `Packing into` words with packed counts; the active one underlined (§9.2). A sealed case refuses to be active. */
export function CaseChips({
  cases, choice, onChoose, onNew,
}: {
  cases: CaseChip[];
  choice: ContainerChoice;
  onChoose: (next: ContainerChoice) => void;
  onNew?: () => void;
}) {
  const word = (key: string, label: string, count: number | null, active: boolean, clicked: string | null, disabled = false) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={disabled ? "Sealed — unseal it to pack more" : undefined}
      onClick={() => onChoose(nextCaseChoice(choice, clicked))}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-1 text-caption font-medium [@media(pointer:fine)]:min-h-8",
        active ? "border-red text-ink" : "border-transparent text-muted hover:text-ink",
        disabled && "opacity-50",
      )}
    >
      {label}
      {count != null && <span className="t-mono text-muted">{count}</span>}
    </button>
  );
  return (
    <div role="group" aria-label="Packing into" className="flex flex-wrap items-center gap-3">
      <span className="text-caption text-muted">Packing into</span>
      {word("loose", "Loose", null, choice === null, null)}
      {cases.map((c) => word(c.id, c.label, c.packed, choice === c.id, c.id, !!c.sealed && choice !== c.id))}
      {onNew && (
        <button type="button" onClick={onNew} className="inline-flex min-h-11 items-center gap-1 text-caption text-muted hover:text-ink [@media(pointer:fine)]:min-h-8">
          <Plus aria-hidden="true" className="size-3.5" /> New
        </button>
      )}
    </div>
  );
}
