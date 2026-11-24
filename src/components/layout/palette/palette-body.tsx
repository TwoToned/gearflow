"use client";

import { useEffect, useRef } from "react";
import { usePaletteKeys } from "./use-palette-keys";
import { usePaletteState, reaches, type PaletteState } from "./use-palette-state";
import { usePaletteActions } from "./use-palette-actions";
import { PaletteInputBar, PaletteMessages, PaletteFooter, type InputBarProps } from "./palette-chrome";
import { PaletteResults } from "./palette-results";

type Actions = ReturnType<typeof usePaletteActions>;

/** The drill crumb's words and icon. */
function crumbOf(s: PaletteState): { label: string; icon: string } | null {
  if (s.entityPage) return { label: s.entityPage.label, icon: s.entityPage.icon };
  if (s.drill) return { label: s.drill.parent.title || s.drill.parent.mono || "", icon: s.drill.parent.icon };
  return null;
}

function placeholderOf(s: PaletteState, crumb: { label: string } | null): string {
  if (s.entityPage) return `Search ${s.entityPage.label}…`;
  if (s.drill) return `Filter ${crumb?.label ?? ""}…`;
  return "Search or jump to…";
}

const valueOf = (s: PaletteState) => (s.drilling ? s.drillQuery : s.query);

function modeOf(s: PaletteState): InputBarProps["mode"] {
  if (s.slash.active) return "slash";
  return s.at.active ? "at" : "search";
}

/** The "nothing here" cases. */
function absenceOf(s: PaletteState) {
  const none = s.rows.length === 0;
  return {
    noMatch: s.plain && s.query.trim().length >= 2 && s.found.settled && none,
    empty: s.isEmpty && none,
    drillEmpty: s.drill !== null && s.drillQuery !== "" && none,
  };
}

/** The `@` and `/` hints, shown while those modes have rows and nothing typed after the prefix. */
function hintsOf(s: PaletteState) {
  const some = s.rows.length > 0;
  return {
    atHint: s.at.active && s.at.atQuery === "" && some,
    slashHint: s.slash.active && s.slash.slashQuery === "" && some,
  };
}

function messagesOf(s: PaletteState) {
  return {
    query: s.query,
    count: s.rows.length,
    entity: s.entityPage ? { label: s.entityPage.label, query: s.drillQuery, loading: s.loading } : null,
    ...absenceOf(s),
    ...hintsOf(s),
  };
}

function footerOf(s: PaletteState, isMobile: boolean) {
  return {
    visible: s.rows.length > 0 || s.drilling,
    isMobile,
    drilling: s.drilling,
    plain: s.plain,
    selectedHasChildren: !!s.rows[s.selectedIndex]?.hasChildren && !s.drilling,
    childToggle: s.hasKids ? (s.showChildren ? ("collapse" as const) : ("expand" as const)) : null,
  };
}

/** The key map's inputs, from the state and the row actions. */
function keysOf(s: PaletteState, a: Actions) {
  return {
    rows: s.rows,
    selectedIndex: s.selectedIndex,
    setSelectedIndex: s.setSelectedIndex,
    drilling: s.drilling,
    drillEmpty: s.drillQuery === "",
    plain: s.plain,
    toggleChildren: (on?: boolean) => s.setShowChildren((prev) => (on === undefined ? !prev : on)),
    exitDrill: a.exitDrill,
    enterDrill: () => a.enterDrill(s.rows[s.selectedIndex]),
    activate: () => a.activate(s.rows[s.selectedIndex]),
  };
}

/**
 * One open ⌘K palette (UX Phase 11, §6d.3). Mounted per open AND per org
 * (`key={orgId}` in `CommandSearch`), so closing it or switching org drops the
 * query, the results, any drill and the selection — nothing from org A is ever
 * on screen in org B.
 */
export function PaletteBody(props: {
  orgId: string | undefined;
  userId: string | undefined;
  initialQuery: string;
  isMobile: boolean;
  onClose: () => void;
  onScan: () => void;
}) {
  const { isMobile } = props;
  const s = usePaletteState(props);
  const a = usePaletteActions(s, props);
  const onKeyDown = usePaletteKeys(keysOf(s, a));
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const crumb = crumbOf(s);

  useEffect(() => {
    itemRefs.current.get(s.selectedIndex)?.scrollIntoView?.({ block: "nearest" });
  }, [s.selectedIndex]);

  const setText = (value: string) => (s.drilling ? s.setDrillQuery(value) : s.setQuery(value));
  const scroller = isMobile ? "flex-1 overflow-y-auto" : "max-h-[60vh] overflow-y-auto";

  return (
    <>
      <PaletteInputBar
        inputRef={inputRef}
        value={valueOf(s)}
        onChange={setText}
        onKeyDown={onKeyDown}
        mode={modeOf(s)}
        crumb={crumb}
        onCrumb={a.exitDrill}
        placeholder={placeholderOf(s, crumb)}
        loading={s.loading}
        showModeButtons={s.plain}
        onMode={(prefix) => {
          setText(prefix);
          inputRef.current?.focus();
        }}
        hasChildren={s.hasKids}
        showChildren={s.showChildren}
        onToggleChildren={() => s.setShowChildren((v) => !v)}
        isMobile={isMobile}
        onCancel={props.onClose}
        onScan={reaches(s.permissions, "warehouse") ? a.scan : undefined}
      />
      <div className={scroller}>
        {s.rows.length > 0 && (
          <PaletteResults
            sections={s.sections}
            showChildren={s.showChildren && !s.drilling}
            selectedIndex={s.selectedIndex}
            isMobile={isMobile}
            onActivate={(row, i) => {
              s.setSelectedIndex(i);
              a.activate(row);
            }}
            onHover={s.setSelectedIndex}
            register={(i, el) => (el ? itemRefs.current.set(i, el) : itemRefs.current.delete(i))}
          />
        )}
        <PaletteMessages {...messagesOf(s)} />
      </div>
      <PaletteFooter {...footerOf(s, isMobile)} />
    </>
  );
}
