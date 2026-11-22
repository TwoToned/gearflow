"use client";
// use-client: interactive — Convex subscriptions + expand state (R-8.1.1)

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { useProjectReadiness } from "@/hooks/use-project-readiness";
import { readinessVerdict, READINESS_VISIBLE_ROWS, type ReadinessVerdict } from "@/lib/job-readiness-verdict";
import type { ReadinessCheck, ReadinessFix } from "@/lib/project-readiness-checks";
import { cn, focusRing } from "@/lib/utils";
import { OverviewSection, OverviewTextButton } from "./overview-parts";

/**
 * Readiness, first on the Overview (spec §6b, UX Phase 7): the verdict as a
 * headline, the first blocker in words with one link to fix it, then the
 * other things to sort as text rows (three shown, `and n more ›` expands)
 * and one micro line naming what is clear. From Out onward a one-line state
 * sentence, with only failing incidents and blocking discussions under it.
 *
 * Every row links to the surface that OWNS its fix (`ReadinessFix`); this
 * section never fixes anything itself.
 */

const HEADLINE_TONE: Record<ReadinessVerdict["tone"], string> = {
  held: "text-t-out",
  todo: "text-ink",
  clear: "text-ok",
  state: "text-ink",
};

const DOT: Record<ReadinessCheck["severity"], string> = {
  blocking: "bg-action-red",
  warning: "bg-warn",
  unknown: "border-[1.5px] border-dashed border-muted",
  pass: "bg-ok",
};

function ReadinessRow({ check, onFix }: { check: ReadinessCheck; onFix: (fix: ReadinessFix) => void }) {
  const fix = check.fix;
  return (
    <li className="border-t border-line">
      <button
        type="button"
        disabled={!fix}
        onClick={() => fix && onFix(fix)}
        className={cn("flex min-h-11 w-full items-center gap-3 py-2 text-left text-table-cell text-ink md:min-h-9", focusRing)}
      >
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[check.severity])} />
        <span className="min-w-0 flex-1">
          {check.title}
          {check.detail ? <span className="text-muted"> · {check.detail}</span> : null}
        </span>
        {check.actionLabel ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-caption text-muted">
            {check.actionLabel}
            <ChevronRight className="size-3" aria-hidden="true" />
          </span>
        ) : null}
      </button>
    </li>
  );
}

function ReadinessRows({ rows, onFix }: { rows: ReadinessCheck[]; onFix: (fix: ReadinessFix) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  if (rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, READINESS_VISIBLE_ROWS);
  const more = rows.length - shown.length;
  return (
    <ul className="mt-3.5" aria-label="Things to sort">
      {shown.map((c) => (
        <ReadinessRow key={c.id} check={c} onFix={onFix} />
      ))}
      {more > 0 || (expanded && rows.length > READINESS_VISIBLE_ROWS) ? (
        <li className="border-t border-line">
          <OverviewTextButton className="text-muted" onClick={() => setExpanded((e) => !e)}>
            {more > 0 ? `and ${more} more ›` : "show fewer"}
          </OverviewTextButton>
        </li>
      ) : null}
    </ul>
  );
}

function ReadinessBody({ verdict, onFix }: { verdict: ReadinessVerdict; onFix: (fix: ReadinessFix) => void }) {
  const lead = verdict.leadCheck;
  return (
    <>
      {/* Size and tone on separate elements: `cn` would merge two `text-*` classes into one. */}
      <h2 className="font-display text-page-title font-bold leading-tight tracking-tight">
        <span className={HEADLINE_TONE[verdict.tone]}>{verdict.headline}</span>
      </h2>
      {verdict.lead ? (
        <p className="mt-1 text-ui-text leading-relaxed text-ink-2">
          {verdict.lead}
          {lead?.fix && lead.actionLabel ? (
            <>
              {" "}
              <OverviewTextButton onClick={() => onFix(lead.fix!)}>
                {lead.actionLabel} ›
              </OverviewTextButton>
            </>
          ) : null}
        </p>
      ) : null}
      <ReadinessRows rows={verdict.rows} onFix={onFix} />
      {verdict.clear.length > 0 ? (
        <p className="t-micro mt-2.5 text-muted">
          {verdict.clear.length} {verdict.clear.length === 1 ? "check" : "checks"} clear · {verdict.clear.map((c) => c.title).join(" · ")}
        </p>
      ) : null}
    </>
  );
}

export function ReadinessSection({
  projectId,
  orgId,
  status,
  onFix,
}: {
  projectId: string;
  orgId: string | undefined;
  status: string;
  onFix: (fix: ReadinessFix) => void;
}) {
  const { checks } = useProjectReadiness(projectId, orgId, true, status);
  return (
    <OverviewSection aria-label="Readiness">
      {checks ? (
        <ReadinessBody verdict={readinessVerdict(checks, status)} onFix={onFix} />
      ) : (
        <p className="text-ui-text text-muted">Checking readiness…</p>
      )}
    </OverviewSection>
  );
}
