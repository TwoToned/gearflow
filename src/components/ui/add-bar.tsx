"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * `AddBar` (spec §5.5): a command-style input docked under a list. Typing
 * searches several sources at once (the caller's `search`); kind chips are
 * words that narrow it; Enter adds with smart defaults (the caller's `onAdd`);
 * a second Enter on the same result opens the row editor (`onOpenEditor`).
 * Generic: Equipment's chips (Gear · Kit · Sub-hire · Custom · Sale) and
 * Logistics' (Delivery · Pickup · Call · Labour · Misc) are `kinds` configs.
 * On a phone the command opens as the shared bottom sheet.
 *
 * It owns no data and no mutation: the existing add dialogs stay as the
 * "more options" step behind the row editor (Phase 2a/5 wire it).
 */
interface AddBarKind {
  key: string;
  label: string;
}

export interface AddBarResult {
  id: string;
  /** The `AddBarKind.key` this result belongs to. */
  kind: string;
  title: string;
  subtitle?: string;
  /** Muted trailing text, e.g. a rate or stock. */
  detail?: string;
}

export interface AddBarProps {
  kinds: AddBarKind[];
  /** `kind` is null when no chip is active (search every source). */
  search: (query: string, kind: string | null) => Promise<AddBarResult[]>;
  onAdd: (result: AddBarResult) => void | Promise<void>;
  onOpenEditor: (result: AddBarResult) => void;
  placeholder?: string;
  /** Text of the phone trigger button. */
  phoneLabel?: string;
  disabled?: boolean;
  className?: string;
}

export type EnterOutcome =
  | { type: "none" }
  | { type: "add"; result: AddBarResult }
  | { type: "edit"; result: AddBarResult };

/** What Enter does: add the highlighted result, or open the editor if it was just added. */
export function resolveEnter(
  results: AddBarResult[],
  index: number,
  lastAddedId: string | null,
): EnterOutcome {
  const result = results[index];
  if (!result) return { type: "none" };
  return result.id === lastAddedId ? { type: "edit", result } : { type: "add", result };
}

export function moveIndex(index: number, by: 1 | -1, length: number): number {
  if (length === 0) return 0;
  return (index + by + length) % length;
}

function useAddBarSearch(search: AddBarProps["search"], query: string, kind: string | null) {
  const [results, setResults] = React.useState<AddBarResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      search(q, kind)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]))
        .finally(() => live && setLoading(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [search, query, kind]);
  return { results, loading };
}

function AddBarCommand({
  kinds,
  search,
  onAdd,
  onOpenEditor,
  placeholder,
  disabled,
  autoFocus,
  opensUpward,
  onDone,
}: AddBarProps & { autoFocus?: boolean; opensUpward?: boolean; onDone?: () => void }) {
  const listId = React.useId();
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<string | null>(null);
  const [index, setIndex] = React.useState(0);
  const [lastAdded, setLastAdded] = React.useState<string | null>(null);
  const { results, loading } = useAddBarSearch(search, query, kind);

  const changeQuery = (q: string) => {
    setQuery(q);
    setIndex(0);
    setLastAdded(null);
  };

  const enter = async () => {
    const out = resolveEnter(results, index, lastAdded);
    if (out.type === "add") {
      setLastAdded(out.result.id);
      await onAdd(out.result);
    } else if (out.type === "edit") {
      changeQuery("");
      onOpenEditor(out.result);
      onDone?.();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void enter();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => moveIndex(i, e.key === "ArrowDown" ? 1 : -1, results.length));
    } else if (e.key === "Escape" && query) {
      e.stopPropagation();
      changeQuery("");
    }
  };

  const showList = query.trim().length > 0;
  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2" role="group" aria-label="Kind">
        {kinds.map((k) => (
          <button
            key={k.key}
            type="button"
            aria-pressed={kind === k.key}
            onClick={() => setKind(kind === k.key ? null : k.key)}
            className={cn(
              "min-h-11 border-b-2 px-0.5 text-[13px] font-medium [@media(pointer:fine)]:min-h-7",
              kind === k.key ? "border-ink text-ink" : "border-transparent text-muted",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-[var(--r)] border-2 border-line-2 bg-elev px-3">
        <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={results[index] ? `${listId}-${results[index].id}` : undefined}
          aria-label="Add to list"
          autoFocus={autoFocus}
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
          // 16 px so iOS does not zoom on focus.
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-muted focus:outline-none"
        />
      </div>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Results"
          className={cn(
            "z-30 mt-1 max-h-72 overflow-y-auto rounded-[var(--r)] border-2 border-line-2 bg-elev shadow-[var(--sh-card)]",
            opensUpward && "absolute inset-x-0 bottom-full mb-1 mt-0",
          )}
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-3 text-[13px] text-muted">
              {loading ? "Searching…" : "No matches"}
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${r.id}`}
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  setIndex(i);
                  setLastAdded(r.id);
                  void onAdd(r);
                }}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 px-3 text-[14px]",
                  i === index && "bg-paper-2",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{r.title}</span>
                  {r.subtitle ? <span className="block truncate text-[12px] text-muted">{r.subtitle}</span> : null}
                </span>
                {r.id === lastAdded ? (
                  <span className="shrink-0 text-[12px] text-muted">Added · Enter to edit</span>
                ) : r.detail ? (
                  <span className="shrink-0 text-[12px] text-muted">{r.detail}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function AddBar(props: AddBarProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const { className, phoneLabel = "Add", disabled } = props;

  if (isMobile) {
    return (
      <div className={className}>
        <Button type="button" variant="line" className="w-full" disabled={disabled} onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          {phoneLabel}
        </Button>
        <BottomSheet open={open} onOpenChange={setOpen} title={phoneLabel}>
          <div className="px-4 pb-2">
            <AddBarCommand {...props} autoFocus onDone={() => setOpen(false)} />
          </div>
        </BottomSheet>
      </div>
    );
  }
  return (
    <div className={className}>
      <AddBarCommand {...props} opensUpward />
    </div>
  );
}
