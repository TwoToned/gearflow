"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { ScanButton } from "@/components/scanner/scan-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ScanModeOption {
  value: string;
  label: string;
}

/** The Prep stage's two modes. Other warehouse stages pass their own verbs
 *  (Deploy, Receive, De-prep) through the `modes` prop. */
export const PREP_SCAN_MODES: ScanModeOption[] = [
  { value: "prep", label: "Prep as I scan" },
  { value: "check", label: "Check only" },
];

interface ScanTarget {
  id: string;
  label: string;
}

/**
 * `ScanDock` (spec §5.7, §9.2): ONE scan input — keyboard wedge (type/scan +
 * Enter) and a camera button — with the active target inside it
 * (`Packing into → LX-04 ▾`) and the mode words below. Presentational: it
 * reports `onScan(raw)`; the single pipeline (Phase 3) does the rest.
 *
 * The camera is the existing `ScanButton` → `CameraScannerDialog` (ONE WASM
 * engine; opens from this click, a user gesture, never from a mount effect).
 * Do not add a `BarcodeDetector` path here (CLAUDE.md camera scanner section).
 */
export interface ScanDockProps {
  onScan: (raw: string) => void;
  /**
   * Mode words under the input; defaults to the Prep stage's two. `[]` renders no
   * mode row at all, for a surface whose modes sit above the dock as stage words
   * (the Scan page's `Check · Test & tag`).
   */
  modes?: ScanModeOption[];
  mode: string;
  onModeChange: (mode: string) => void;
  /** Active target and its alternatives; omit when the surface has no target concept. */
  target?: { verb: string; current: ScanTarget | null; options: ScanTarget[]; onChange: (id: string) => void };
  placeholder?: string;
  cameraTitle?: string;
  /**
   * Keep the camera live after a read (batch scanning, the default). `false` closes
   * the sheet on the first read, for a surface that loads one item per scan (the Scan
   * page, spec §9i.5). Only passes the existing `continuous` flag through.
   */
  cameraContinuous?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * Every change to the typed text (including the clear after a submit), for a
   * surface that filters as you type (the floor). The dock still owns the value.
   */
  onValueChange?: (value: string) => void;
  /** Lets a surface focus the input from elsewhere (a head `Scan` button). */
  inputRef?: React.Ref<HTMLInputElement>;
  /** The input's DOM id, so a label or a skip link can target it. */
  inputId?: string;
}

export function ScanDock({
  onScan,
  modes = PREP_SCAN_MODES,
  mode,
  onModeChange,
  target,
  placeholder = "Scan or type a tag",
  cameraTitle = "Scan with camera",
  cameraContinuous = true,
  disabled,
  className,
  onValueChange,
  inputRef,
  inputId,
}: ScanDockProps) {
  const [value, setValueState] = React.useState("");
  const setValue = (next: string) => {
    setValueState(next);
    onValueChange?.(next);
  };

  const submit = () => {
    const raw = value.trim();
    if (!raw) return;
    onScan(raw);
    setValue("");
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 rounded-[var(--r)] border-2 border-line-2 bg-elev px-3">
        {target ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex min-h-11 shrink-0 items-center gap-1 text-caption text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
              aria-label={`${target.verb} ${target.current?.label ?? "no target"}, change`}
            >
              {target.verb} <span aria-hidden="true">→</span>
              <span className="font-medium text-ink">{target.current?.label ?? "Choose"}</span>
              <ChevronDown aria-hidden="true" className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {target.options.map((o) => (
                <DropdownMenuItem key={o.id} onSelect={() => target.onChange(o.id)}>
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          // 16 px so iOS does not zoom on focus.
          className="min-h-11 min-w-0 flex-1 bg-transparent text-reading-body text-ink placeholder:text-muted focus:outline-none"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Scan input"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <ScanButton onScan={onScan} scannerTitle={cameraTitle} continuous={cameraContinuous} disabled={disabled} />
      </div>
      {modes.length > 0 ? <ModeWords modes={modes} mode={mode} onModeChange={onModeChange} /> : null}
    </div>
  );
}

function ModeWords({ modes, mode, onModeChange }: { modes: ScanModeOption[]; mode: string; onModeChange: (mode: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Scan mode" className="flex items-center gap-4 text-caption">
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          onClick={() => onModeChange(m.value)}
          className={cn(
            "min-h-11 border-b-2 px-1 font-medium [@media(pointer:fine)]:min-h-8",
            mode === m.value ? "border-ink text-ink" : "border-transparent text-muted",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
