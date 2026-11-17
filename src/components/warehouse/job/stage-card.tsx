"use client";

import { ScanDock, PREP_SCAN_MODES } from "@/components/ui/scan-dock";
import { ScanStrip, type ScanStripEntry } from "@/components/ui/scan-strip";
import { StageFilter, type StageFilterOption } from "@/components/ui/stage-filter";
import type { JobStage } from "@/lib/warehouse-job-rows";
import { OUT_LABEL } from "@/lib/vocabulary";

export type JobStageKey = JobStage | "closeout";

/** Stage words and counts, from the one vocabulary table (§4). Close-out is the sixth word (locked prototype). */
export function stageOptions(counts: Record<JobStage, number>, closeoutFlags = 0): StageFilterOption[] {
  return [
    { key: "pick", label: "To pick", count: counts.pick },
    { key: "prepped", label: "Prepped", count: counts.prepped },
    { key: "out", label: OUT_LABEL, count: counts.out },
    { key: "returned", label: "Returned", count: counts.returned },
    { key: "deprepped", label: "De-prepped", count: counts.deprepped },
    { key: "closeout", label: "Close-out", count: closeoutFlags },
  ];
}

const VERB: Record<JobStage, { word: string; placeholder: string }> = {
  pick: { word: "Prep", placeholder: "Scan or enter asset tag to prep…" },
  prepped: { word: "Deploy", placeholder: "Scan or enter asset tag to deploy…" },
  out: { word: "Receive", placeholder: "Scan or enter asset tag to receive…" },
  returned: { word: "De-prep", placeholder: "Scan or enter asset tag to de-prep…" },
  deprepped: { word: "Look up", placeholder: "Scan or enter asset tag to look up…" },
};

/** The dock's mode words and placeholder follow the stage's verb; `Check only` resolves and shows with NO write. */
export function dockConfigFor(stage: JobStage) {
  const v = VERB[stage];
  return {
    placeholder: v.placeholder,
    modes: stage === "pick" ? PREP_SCAN_MODES : [{ value: "prep", label: `${v.word} as I scan` }, { value: "check", label: "Check only" }],
  };
}

/** The strip + dock + result strip at the top of the one card (§9.2); toolbars come in as children. */
export function StageCard({
  stage, counts, closeoutFlags, onStageChange, onScan, mode, onModeChange, caseTarget, entries, disabledScan, children,
}: {
  stage: JobStageKey;
  counts: Record<JobStage, number>;
  closeoutFlags?: number;
  onStageChange: (key: JobStageKey) => void;
  onScan: (raw: string) => void;
  mode: string;
  onModeChange: (mode: string) => void;
  caseTarget?: React.ComponentProps<typeof ScanDock>["target"];
  entries: ScanStripEntry[];
  disabledScan?: boolean;
  children?: React.ReactNode;
}) {
  const cfg = dockConfigFor(stage === "closeout" ? "deprepped" : stage);
  return (
    <div className="flex flex-col gap-3">
      <StageFilter
        options={stageOptions(counts, closeoutFlags)}
        value={stage}
        onChange={(k) => k && onStageChange(k as JobStageKey)}
        label="Job stage"
      />
      {stage !== "closeout" && (
        <>
          <ScanDock
            onScan={onScan}
            modes={cfg.modes}
            mode={mode}
            onModeChange={onModeChange}
            target={caseTarget}
            placeholder={cfg.placeholder}
            cameraTitle={`Scan gear to ${VERB[stage].word.toLowerCase()}`}
            disabled={disabledScan}
          />
          <ScanStrip entries={entries} />
        </>
      )}
      {children}
    </div>
  );
}
