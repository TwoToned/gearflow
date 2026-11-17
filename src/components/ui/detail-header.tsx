"use client";

import * as React from "react";
import { ChevronDown, Lock } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { StatusWord } from "@/components/ui/status-word";
import type { ActionMenuSpec, StatusValue } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/**
 * `DetailHeader` (spec §5.9 as amended by D92, built to §6b's calm header):
 * title · status word · a small lock glyph with its menu; a meta line; one
 * primary, `Documents ▾`, `Edit`, ⋯; a thin progress line; and ONE quiet strip
 * slot for a non-live version. No chips: the version lives in ⋯ and under `V`,
 * the lock is the glyph, not a banner. The warehouse variant swaps the meta
 * line for the packer's facts.
 */
export interface DetailHeaderStep {
  key: string;
  label: string;
}

export interface PackerFacts {
  loadsOut?: string;
  truck?: string;
  packing?: string[];
}

export interface DetailHeaderProps {
  title: string;
  status: StatusValue;
  /**
   * The pricing-lock glyph. `label` titles the menu (`Pricing locked · Jayden ·
   * Thu 6 Nov`); `summary` says what is read-only and is the glyph's tooltip.
   */
  lock?: { label: string; summary: string; menu: ActionMenuSpec };
  /** Job variant: number · client · dates · days, joined with a middle dot. */
  meta?: React.ReactNode[];
  /** Warehouse variant: the packer's facts replace the meta line. */
  variant?: "job" | "warehouse";
  packerFacts?: PackerFacts;
  /** The one primary, e.g. `Advance to Prep`. Absent at the end of the pipeline. */
  primary?: { label: string; onSelect: () => void | Promise<void>; disabled?: boolean };
  documents?: ActionMenuSpec;
  onEdit?: () => void;
  menu?: ActionMenuSpec;
  /** Thin progress line: done = ink, current = red, upcoming = hairline. */
  progress?: {
    steps: DetailHeaderStep[];
    currentIndex: number;
    /** Sub-status under a two-status stage (`Quote · quoted`). */
    subLabel?: string;
    /** e.g. a `Set status ▾` text link, rendered under the line. */
    action?: React.ReactNode;
  };
  /** The one quiet strip, only when it matters (a viewed non-live version). */
  strip?: React.ReactNode;
  className?: string;
}

function LockGlyph({ lock }: { lock: NonNullable<DetailHeaderProps["lock"]> }) {
  return (
    <ActionMenu
      spec={lock.menu}
      label={lock.label}
      trigger={
        <button
          type="button"
          aria-label={lock.label}
          title={lock.summary}
          className="inline-flex size-[22px] items-center justify-center rounded-full border border-line-2 text-muted hover:border-control-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red [@media(pointer:coarse)]:size-11"
        >
          <Lock className="size-[11px]" aria-hidden="true" />
        </button>
      }
    />
  );
}

function PackerFactsLine({ facts }: { facts: PackerFacts }) {
  const parts = [
    facts.loadsOut ? `Loads out ${facts.loadsOut}` : null,
    facts.truck ? `Truck ${facts.truck}` : null,
    facts.packing?.length ? `Packing ${facts.packing.join(", ")}` : null,
  ].filter((p): p is string => !!p);
  return <MetaLine parts={parts} />;
}

function MetaLine({ parts }: { parts: React.ReactNode[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{p}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

type StepState = "done" | "current" | "upcoming";

const STEP_BAR: Record<StepState, string> = { done: "bg-ink-2", current: "bg-red", upcoming: "bg-line-2" };

function ProgressStep({ step, state, subLabel }: { step: DetailHeaderStep; state: StepState; subLabel?: string }) {
  return (
    <li
      data-state={state}
      aria-current={state === "current" ? "step" : undefined}
      // Phone: only the current label shows (§6b).
      className={cn("min-w-0 flex-1", state !== "current" && "max-md:[&>span]:hidden")}
    >
      <i className={cn("mb-1.5 block h-[3px] rounded-sm", STEP_BAR[state])} />
      <span className={cn("block truncate text-[11px]", state === "current" ? "font-semibold text-ink" : "text-faint")}>
        {step.label}
        {state === "current" && subLabel ? ` · ${subLabel}` : ""}
      </span>
    </li>
  );
}

function Progress({ progress }: { progress: NonNullable<DetailHeaderProps["progress"]> }) {
  const { steps, currentIndex, subLabel, action } = progress;
  const stateOf = (i: number): StepState => (i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming");
  return (
    <div>
      <ol className="flex gap-1" aria-label="Progress">
        {steps.map((s, i) => (
          <ProgressStep key={s.key} step={s} state={stateOf(i)} subLabel={subLabel} />
        ))}
      </ol>
      {action ? <div className="mt-1.5 flex justify-end">{action}</div> : null}
    </div>
  );
}

function TitleBlock({
  title,
  status,
  lock,
  meta,
  variant,
  packerFacts,
}: Pick<DetailHeaderProps, "title" | "status" | "lock" | "meta" | "variant" | "packerFacts">) {
  const facts = variant === "warehouse" && packerFacts ? <PackerFactsLine facts={packerFacts} /> : null;
  return (
    <div className="min-w-0 flex-1 basis-80">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
        <StatusWord status={status} />
        {lock ? <LockGlyph lock={lock} /> : null}
      </div>
      {facts ?? (meta?.length ? <MetaLine parts={meta} /> : null)}
    </div>
  );
}

function ActionRow({ primary, documents, onEdit, menu }: Pick<DetailHeaderProps, "primary" | "documents" | "onEdit" | "menu">) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary ? (
        <Button size="sm" disabled={primary.disabled} onClick={() => void primary.onSelect()}>
          {primary.label}
        </Button>
      ) : null}
      {documents?.items.length ? (
        <ActionMenu
          spec={documents}
          label="Documents"
          trigger={
            <Button type="button" size="sm" variant="line">
              Documents
              <ChevronDown className="size-3" aria-hidden="true" />
            </Button>
          }
        />
      ) : null}
      {onEdit ? (
        <Button type="button" size="sm" variant="line" onClick={onEdit}>
          Edit
        </Button>
      ) : null}
      {menu ? <ActionMenu spec={menu} label="More actions" /> : null}
    </div>
  );
}

export function DetailHeader({ progress, strip, className, variant = "job", ...rest }: DetailHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start gap-4">
        <TitleBlock {...rest} variant={variant} />
        <ActionRow {...rest} />
      </div>
      {progress ? <Progress progress={progress} /> : null}
      {strip ? <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-paper-2 px-3.5 py-2.5 text-[13px] text-ink-2">{strip}</div> : null}
    </header>
  );
}
