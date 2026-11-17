"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  CircleDashed,
  CircleSlash,
  EyeOff,
  FileMinus,
  Package,
  PencilLine,
  Puzzle,
} from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StateGlyph, StateGlyphKey } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/** One icon per state, the same everywhere (spec §5.4). */
export const GLYPH_ICONS: Record<StateGlyphKey, LucideIcon> = {
  priceHidden: EyeOff,
  hiddenOnDocs: FileMinus,
  excludedFromRoi: CircleSlash,
  optional: CircleDashed,
  manualPrice: PencilLine,
  needsCheck: AlertCircle,
  plannedCase: Package,
  accessoriesModified: Puzzle,
};

/** Neutral by default; only a state that needs attention is warm. */
const WARM: ReadonlySet<StateGlyphKey> = new Set<StateGlyphKey>(["needsCheck"]);

/** An 18 px glyph with a tooltip. Owns its `TooltipProvider` (CLAUDE.md). */
export function StateGlyphIcon({ glyph, className }: { glyph: StateGlyph; className?: string }) {
  const Icon = GLYPH_ICONS[glyph.key];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={glyph.tooltip}
          data-glyph={glyph.key}
          className={cn(
            "inline-grid size-[18px] shrink-0 place-items-center rounded-[5px] outline-none",
            "focus-visible:ring-2 focus-visible:ring-red",
            WARM.has(glyph.key) ? "text-warn" : "text-muted hover:text-ink",
            className,
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>{glyph.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function StateGlyphs({ glyphs }: { glyphs?: StateGlyph[] }) {
  if (!glyphs?.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {glyphs.map((g) => (
        <StateGlyphIcon key={g.key} glyph={g} />
      ))}
    </span>
  );
}
