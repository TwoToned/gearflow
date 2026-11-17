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

export type ScanMode = "prep" | "check";

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  prep: "Prep as I scan",
  check: "Check only",
};

export interface ScanTarget {
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
  mode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  /** Active target and its alternatives; omit when the surface has no target concept. */
  target?: { verb: string; current: ScanTarget | null; options: ScanTarget[]; onChange: (id: string) => void };
  placeholder?: string;
  cameraTitle?: string;
  disabled?: boolean;
  className?: string;
}

export function ScanDock({
  onScan,
  mode,
  onModeChange,
  target,
  placeholder = "Scan or type a tag",
  cameraTitle = "Scan with camera",
  disabled,
  className,
}: ScanDockProps) {
  const [value, setValue] = React.useState("");

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
          // 16 px so iOS does not zoom on focus.
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-muted focus:outline-none"
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
        <ScanButton onScan={onScan} scannerTitle={cameraTitle} continuous disabled={disabled} />
      </div>
      <div role="radiogroup" aria-label="Scan mode" className="flex items-center gap-4 text-caption">
        {(Object.keys(SCAN_MODE_LABELS) as ScanMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => onModeChange(m)}
            className={cn(
              "min-h-11 border-b-2 px-1 font-medium [@media(pointer:fine)]:min-h-8",
              mode === m ? "border-ink text-ink" : "border-transparent text-muted",
            )}
          >
            {SCAN_MODE_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
