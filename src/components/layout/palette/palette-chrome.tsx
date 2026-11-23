"use client";

import type { KeyboardEvent, RefObject } from "react";
import { AtSign, ChevronRight, ChevronsUpDown, Loader2, Search, Slash, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { noMatchCopy } from "@/lib/palette/model";
import { cn } from "@/lib/utils";
import { PaletteIcon } from "./palette-icons";

const KBD = "rounded border bg-bg-inset px-1 font-mono text-[10px]";
const MODE_BUTTON = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-fg-3 transition-colors hover:bg-accent hover:text-primary";
const CHIP = "flex min-h-11 items-center gap-1 rounded-full border border-line px-3 text-[13px] text-ink-2";

function ModeIcon({ mode, crumb }: { mode: "slash" | "at" | "search"; crumb: boolean }) {
  if (mode === "slash") return <Slash className="h-4 w-4 shrink-0 text-primary" />;
  if (mode === "at" && !crumb) return <AtSign className="h-4 w-4 shrink-0 text-primary" />;
  return <Search className="h-4 w-4 shrink-0 text-fg-3" />;
}

/** The drill crumb: what you're inside (a page's records, a row's children); click to step out. */
function Crumb({ crumb, onClick }: { crumb: { label: string; icon: string }; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/80">
      <PaletteIcon icon={crumb.icon} className="h-3 w-3" />
      <span className="max-w-[150px] truncate">{crumb.label}</span>
      <ChevronRight className="h-3 w-3 text-fg-3" />
      <X className="h-3 w-3 text-fg-3/60" />
    </button>
  );
}

/** The phone's word chips under the input (§6d.6): `@ Pages`, `/ Actions`, `Scan a tag`. */
function PhoneChips({ onMode, onScan }: { onMode: (prefix: string) => void; onScan?: () => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b px-3 py-2">
      <button type="button" className={CHIP} onClick={() => onMode("@")}>
        <span className="font-mono text-primary">@</span> Pages
      </button>
      <button type="button" className={CHIP} onClick={() => onMode("/")}>
        <span className="font-mono text-primary">/</span> Actions
      </button>
      {onScan && (
        <button type="button" className={CHIP} onClick={onScan}>
          Scan a tag
        </button>
      )}
    </div>
  );
}

export interface InputBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  mode: "slash" | "at" | "search";
  crumb: { label: string; icon: string } | null;
  onCrumb: () => void;
  placeholder: string;
  loading: boolean;
  showModeButtons: boolean;
  onMode: (prefix: string) => void;
  hasChildren: boolean;
  showChildren: boolean;
  onToggleChildren: () => void;
  isMobile: boolean;
  onCancel: () => void;
  onScan?: () => void;
}

/** The input row: mode glyph, drill crumb, the box, then `/` `@` (desktop) or `Cancel` (phone). */
export function PaletteInputBar({ inputRef, ...p }: InputBarProps) {
  return (
    <>
      <div className="flex items-center gap-1 border-b px-3">
        <ModeIcon mode={p.mode} crumb={!!p.crumb} />
        {p.crumb && <Crumb crumb={p.crumb} onClick={p.onCrumb} />}
        <Input
          ref={inputRef}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={p.onKeyDown}
          placeholder={p.placeholder}
          aria-label="Search or jump to"
          className={cn("h-11 border-0 px-2 shadow-none focus-visible:ring-0", p.isMobile && "text-base")}
        />
        {p.loading && <Loader2 className="h-4 w-4 animate-spin text-fg-3" aria-label="Searching" />}
        <InputBarEnd {...p} />
      </div>
      {p.isMobile && p.showModeButtons && <PhoneChips onMode={p.onMode} onScan={p.onScan} />}
    </>
  );
}

/** The input row's right end: `/` `@` (desktop), the children toggle, `Cancel` (phone). */
function InputBarEnd(p: Omit<InputBarProps, "inputRef">) {
  return (
    <>
      {p.showModeButtons && !p.isMobile && (
        <>
          <button type="button" onClick={() => p.onMode("/")} className={MODE_BUTTON} title="Page actions (/)">/</button>
          <button type="button" onClick={() => p.onMode("@")} className={MODE_BUTTON} title="Navigate to page (@)">@</button>
        </>
      )}
      {p.hasChildren && (
        <button type="button" onClick={p.onToggleChildren} className="shrink-0 rounded p-1 text-fg-3 transition-colors hover:bg-accent hover:text-fg" title={p.showChildren ? "Collapse children (⌘L)" : "Expand children (⌘L)"}>
          <ChevronsUpDown className="h-4 w-4" />
        </button>
      )}
      {p.isMobile && (
        <button type="button" onClick={p.onCancel} className="min-h-11 shrink-0 px-2 text-[15px] font-medium text-ink-2">
          Cancel
        </button>
      )}
    </>
  );
}

const MESSAGE = "py-6 text-center text-sm text-fg-3";

/** Every "there's nothing here" line, in one place: no match, empty, a drill with nothing, the `@` and `/` hints. */
export function PaletteMessages(p: {
  query: string;
  count: number;
  noMatch: boolean;
  empty: boolean;
  entity: { label: string; query: string; loading: boolean } | null;
  drillEmpty: boolean;
  atHint: boolean;
  slashHint: boolean;
}) {
  if (p.noMatch) {
    const copy = noMatchCopy(p.query);
    return (
      <div className="px-4 py-6 text-center" role="status">
        <p className="text-sm font-medium text-ink">{copy.title}</p>
        <p className="mt-1 text-xs text-fg-3">{copy.hint}</p>
      </div>
    );
  }
  if (p.entity) return <EntityMessage entity={p.entity} count={p.count} />;
  if (p.drillEmpty) return <div className={MESSAGE}>No matching children.</div>;
  if (p.empty) {
    return (
      <div className={MESSAGE}>
        Type to search… <span className="font-medium text-primary">@</span> pages · <span className="font-medium text-primary">/</span> actions
      </div>
    );
  }
  if (p.atHint) return <p className="px-4 pb-2 text-xs text-fg-3">Type a page name to go there · add a space to search its records (e.g. <span className="font-medium text-primary">@jobs hilton</span>)</p>;
  if (p.slashHint) return <p className="px-4 pb-2 text-xs text-fg-3">Type a command name to filter (e.g. <span className="font-medium text-primary">/quote</span>)</p>;
  return null;
}

function EntityMessage({ entity, count }: { entity: { label: string; query: string; loading: boolean }; count: number }) {
  if (entity.query.length < 2) return <div className={MESSAGE}>Type to search {entity.label}…</div>;
  if (count === 0 && !entity.loading) return <div className={MESSAGE}>{`Nothing matches “${entity.query.trim()}” in ${entity.label}.`}</div>;
  return null;
}

function Hint({ keys, children }: { keys: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className={KBD}>{keys}</kbd>
      {children}
    </span>
  );
}

/** The key hints (desktop) or `Tap to open` (phone). */
export function PaletteFooter(p: {
  visible: boolean;
  isMobile: boolean;
  drilling: boolean;
  plain: boolean;
  selectedHasChildren: boolean;
  childToggle: "collapse" | "expand" | null;
}) {
  if (!p.visible) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-3 border-t px-3 py-1.5 text-xs text-fg-3", p.isMobile && "pb-[calc(0.375rem+env(safe-area-inset-bottom))]")}>
      {p.isMobile ? (
        <span>{p.drilling ? "Tap to open · Cancel to close" : "Tap to open"}</span>
      ) : (
        <>
          <Hint keys="↑↓">navigate</Hint>
          {p.plain && <Hint keys="⇧↑↓">skip</Hint>}
          <Hint keys="⏎">open</Hint>
          {p.selectedHasChildren && <Hint keys="Tab">drill in</Hint>}
          {p.drilling && <Hint keys="Esc">back</Hint>}
          {p.childToggle && <Hint keys="⇧←→">{p.childToggle}</Hint>}
        </>
      )}
    </div>
  );
}
