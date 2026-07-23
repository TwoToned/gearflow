"use client";

/**
 * Playful auth shell — decorative-only furniture for the login / register /
 * admin-register screens. Everything here is cosmetic: stickers, doodles, the
 * brand collage panel. It NEVER touches form logic. All decorative nodes are
 * `aria-hidden` + `pointer-events-none` so the keyboard/AT experience is
 * identical to a plain form.
 *
 * Stays inside DESIGN.md: dark espresso (`bg-paper`), single RVLT red accent,
 * hard offset shadows (`--sh-stk` / `--sh-card`), module-hue FeaturePatch
 * stickers (red is never a module hue), Kalam (`font-hand`) for handwritten
 * annotations only — and auth pages explicitly follow the marketing aesthetic
 * (DESIGN.md §17 "Auth pages"), so personality/mascot/Kalam are sanctioned here.
 *
 * Mobbin references: komoot (hand-drawn doodles + Kalam annotations scattered
 * round the form), Alan (mascot with orbiting sticker objects), Sprig/Gusto
 * (split-panel brand side + functional form side).
 */

import * as React from "react";
import { FeaturePatch } from "@/components/ui/feature-patch";
import { FlowMascot } from "@/components/ui/flow-mascot";
import { RvltFlowLogo } from "@/components/brand/rvlt-flow-logo";
import { FadeIn } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import {
  Zap,
  Truck,
  Wrench,
  CalendarCheck,
  Boxes,
  Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * GAFF tape-roll sticker — the production-industry in-joke brand mark *
 * (DESIGN.md §17). No SVG asset exists, so this is a tasteful CSS      *
 * roll: concentric rings with a torn-tape tab. Purely decorative.     *
 * ------------------------------------------------------------------ */
function GaffSticker({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none relative flex size-[58px] items-center justify-center rounded-full",
        "bg-gaff-tape text-ink shadow-[var(--sh-stk)] ring-2 ring-ink/15",
        className,
      )}
    >
      {/* outer ring */}
      <div className="absolute inset-[6px] rounded-full border-2 border-ink/25" />
      {/* inner core */}
      <div className="flex size-[22px] items-center justify-center rounded-full bg-card ring-2 ring-ink/20">
        <span className="t-annotation text-[9px] leading-none text-muted">GAFF</span>
      </div>
      {/* torn tape tab peeling off the roll */}
      <div className="absolute -right-3 top-1/2 h-3 w-7 -translate-y-1/2 -rotate-6 rounded-r-sm bg-ink/85 [clip-path:polygon(0_0,100%_18%,92%_82%,0_100%)]" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Generic CSS "sticker" chip — rounded, rotated, hard-offset shadow.  *
 * Used for little word / emoji-free label stickers.                   *
 * ------------------------------------------------------------------ */
function StickerChip({
  children,
  className,
  tone = "cream",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "cream" | "red" | "ink";
}) {
  const tones = {
    cream: "bg-cream text-cream-ink ring-cream-ink/10",
    red: "bg-red text-primary-foreground ring-red-700/40",
    ink: "bg-elev text-ink ring-line-2",
  } as const;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none inline-flex select-none items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold ring-2 shadow-[var(--sh-stk)]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* Hand-drawn squiggle arrow doodle (SVG, currentColor). */
function DoodleArrow({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 64 40"
      fill="none"
      className={cn("pointer-events-none", className)}
    >
      <path
        d="M3 8c14 22 33 26 54 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M48 33c5-3 9-6 9-7-2 0-7-1-11-3"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Hand-drawn sparkle / star burst doodle. */
function DoodleStar({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      fill="none"
      className={cn("pointer-events-none", className)}
    >
      <path
        d="M16 2c1.4 7.6 4.4 10.6 12 12-7.6 1.4-10.6 4.4-12 12-1.4-7.6-4.4-10.6-12-12 7.6-1.4 10.6-4.4 12-12Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* Hand-drawn loose squiggle / underline doodle. */
function DoodleSquiggle({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 88 16"
      fill="none"
      className={cn("pointer-events-none", className)}
    >
      <path
        d="M2 11c8-9 16 5 24-2s16 5 24-2 16 5 24-2"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * BrandCollage — the desktop-only red/espresso panel: wordmark, the FlowMascot
 * roadie, a collage of module-hue FeaturePatch stickers, a GAFF roll, doodles
 * and a Kalam annotation. Hidden below lg. Fully decorative.
 */
function BrandCollage() {
  return (
    <div className="relative hidden flex-1 overflow-hidden bg-paper-2 lg:flex">
      {/* dot grid texture */}
      <div aria-hidden className="absolute inset-0 opacity-[0.06]">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="auth-dot-grid" x="0" y="0" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.1" fill="currentColor" className="text-ink" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-dot-grid)" />
        </svg>
      </div>

      {/* big soft red glow blobs (no gradient on surfaces — these are radial halos behind content) */}
      <div aria-hidden className="absolute -left-24 -top-24 size-72 rounded-full bg-red-soft blur-2xl" />
      <div aria-hidden className="absolute -bottom-28 -right-16 size-80 rounded-full bg-red-soft blur-2xl" />

      {/* scattered decorative stickers around the panel */}
      <div aria-hidden className="absolute inset-0">
        <FeaturePatch hue="amber" className="absolute left-[12%] top-[16%] -rotate-12">
          <Truck />
        </FeaturePatch>
        <FeaturePatch hue="blue" size="sm" className="absolute right-[16%] top-[12%] rotate-[14deg]">
          <Boxes />
        </FeaturePatch>
        <FeaturePatch hue="green" className="absolute bottom-[20%] left-[8%] rotate-[10deg]">
          <CalendarCheck />
        </FeaturePatch>
        <FeaturePatch hue="coral" size="sm" className="absolute bottom-[30%] right-[12%] -rotate-[8deg]">
          <Wrench />
        </FeaturePatch>

        <GaffSticker className="absolute right-[8%] bottom-[14%] rotate-[8deg]" />

        <DoodleStar className="absolute left-[24%] top-[38%] size-6 -rotate-12 text-red" />
        <DoodleStar className="absolute right-[26%] top-[44%] size-4 rotate-12 text-warn" />
        <DoodleArrow className="absolute right-[22%] top-[60%] h-9 w-14 rotate-[8deg] text-ink-2/70" />

        <StickerChip tone="red" className="absolute left-[14%] top-[64%] -rotate-[6deg]">
          <Zap className="size-3" /> live & loaded
        </StickerChip>
        <StickerChip tone="cream" className="absolute right-[10%] top-[28%] rotate-[7deg]">
          gear that never goes walkabout
        </StickerChip>
      </div>

      {/* center content — wordmark, mascot, tagline */}
      <div className="relative z-10 m-auto flex max-w-md flex-col items-start gap-7 px-12">
        <FadeIn>
          <RvltFlowLogo className="h-9 w-auto" title="RVLT Flow" />
        </FadeIn>

        <FadeIn delay={0.05} className="relative">
          {/* the roadie mascot, big and friendly, with an orbiting sticker */}
          <div className="relative inline-flex">
            <FlowMascot className="size-28 text-ink-2" />
            <FeaturePatch
              hue="purple"
              size="sm"
              aria-hidden
              className="absolute -right-4 -top-3 rotate-[16deg]"
            >
              <Sparkles />
            </FeaturePatch>
            <DoodleSquiggle className="absolute -bottom-2 left-1 h-3 w-20 text-red" />
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <p className="t-display max-w-sm text-[30px] leading-[1.12] text-ink">
            Run the show, not the{" "}
            <span className="text-red">chaos</span>.
          </p>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-ink-2">
            Jobs, crew, warehouse and gear — one calm command room for the
            whole production company.
          </p>
          <p className="t-annotation mt-4 inline-flex items-center gap-2 text-[16px] text-red">
            psst — the roadie&apos;s got your back
            <DoodleArrow className="h-6 w-9 rotate-[170deg] text-red" />
          </p>
        </FadeIn>
      </div>
    </div>
  );
}

/**
 * AuthShell — full-bleed split layout. Brand collage on the left (desktop),
 * the children (form) floated on a card on the right with a couple of stickers
 * peeking over the card edge. `accent` swaps the corner sticker per surface.
 */
export function AuthShell({
  children,
  annotation,
  accent = "welcome",
}: {
  children: React.ReactNode;
  /** Optional Kalam caption shown under the card (decorative). */
  annotation?: string;
  accent?: "welcome" | "join" | "admin";
}) {
  const cornerSticker =
    accent === "join" ? (
      <StickerChip tone="red" className="rotate-[8deg]">
        <Sparkles className="size-3" /> new here? nice.
      </StickerChip>
    ) : accent === "admin" ? (
      <StickerChip tone="ink" className="rotate-[8deg]">
        <Zap className="size-3" /> keys to the kingdom
      </StickerChip>
    ) : (
      <StickerChip tone="cream" className="rotate-[8deg]">
        welcome back!
      </StickerChip>
    );

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen bg-paper">
      <BrandCollage />

      {/* form side */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
        {/* mobile-only faint dot grid so the form side isn't a flat void */}
        <div aria-hidden className="absolute inset-0 opacity-[0.05] lg:hidden">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="url(#auth-dot-grid)" />
          </svg>
        </div>

        {/* loose doodles drifting around the form side */}
        <DoodleStar
          aria-hidden
          className="absolute left-[12%] top-[18%] size-5 -rotate-12 text-red/70"
        />
        <DoodleStar
          aria-hidden
          className="absolute bottom-[16%] right-[14%] size-4 rotate-12 text-warn/70"
        />
        <DoodleSquiggle
          aria-hidden
          className="absolute bottom-[24%] left-[16%] h-3 w-16 text-ink-2/40"
        />

        <FadeIn className="relative w-full max-w-sm">
          {/* sticker peeking over the top-right corner of the card */}
          <div aria-hidden className="pointer-events-none absolute -right-3 -top-4 z-20">
            {cornerSticker}
          </div>
          {/* a little patch peeking over the bottom-left */}
          <FeaturePatch
            hue="amber"
            size="sm"
            aria-hidden
            className="pointer-events-none absolute -bottom-4 -left-4 z-20 -rotate-[12deg]"
          >
            <Boxes />
          </FeaturePatch>

          {/* the actual card surface that wraps the (untouched) form */}
          <div className="rounded-[var(--r-lg)] border-2 border-line-2 bg-card p-6 shadow-[var(--sh-card)] sm:p-8">
            {/* mobile-only mini wordmark (desktop has the collage) */}
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <RvltFlowLogo className="h-6 w-auto" title="RVLT Flow" />
              <GaffSticker className="size-9 [&_span]:text-[7px]" />
            </div>

            {children}
          </div>

          {annotation ? (
            <p
              aria-hidden
              className="t-annotation mt-5 flex items-center justify-center gap-2 text-center text-[15px] text-muted"
            >
              <DoodleStar className="size-3 text-red" />
              {annotation}
            </p>
          ) : null}
        </FadeIn>
      </div>
    </div>
  );
}

/** A small Kalam annotation with a doodle arrow — for inline nudges (e.g. passkey). */
export function HandNudge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "t-annotation pointer-events-none inline-flex items-center gap-1.5 text-[14px] text-red",
        className,
      )}
    >
      {children}
      <DoodleArrow className="h-5 w-8 text-red" />
    </span>
  );
}
